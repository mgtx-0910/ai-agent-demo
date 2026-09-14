/**
 * evaluate.mjs —— Langfuse 离线评测：Dataset → Experiment（task + evaluators）→ Scores
 *
 * 与 index.mjs 的分工：
 *   index.mjs    回答「一次运行长什么样」（在线观测，看 trace）
 *   本文件        回答「一批用例上表现如何」（离线评测，看得分），
 *                 跑完能在 Langfuse 的 Dataset Run 里横向对比不同模型 / 不同参数的得分
 *
 * 概念对应（Langfuse 术语 → 本文件实现）：
 *   Dataset   评测集，一条用例 = 一个 item（input / expectedOutput / metadata）
 *   Task      被测函数：把 item.input 喂给 Agent，产出 output      → runAgentTask
 *   Evaluator 评分器：拿 item 上下文打分（0/1、数值、注释）        → keywordHitEvaluator / nonEmptyEvaluator
 *   Run       一次完整实验，用 runName 区分，便于多次结果对比      → dataset.runExperiment(...)
 *
 * 流程：
 * 1. 确保评测 Dataset 存在并写入测试用例
 * 2. 对每条用例跑 Deep Agent（带 CallbackHandler，生成 Trace）
 * 3. 用确定性 evaluator 打分（关键词命中 / 必含数字等）
 * 4. 用 run-level evaluator 汇总平均分
 * 5. flush 后可在 Langfuse Datasets → Runs 对比结果
 *
 * 为什么用「确定性 evaluator」而不是 LLM-as-Judge：
 *   本示例答案可枚举（温度 31/28、和 59），关键词断言便宜、秒级、可复现、零额外依赖；
 *   生产里对开放式问答才需要 LLM judge，可用 @langfuse/client 的 createEvaluatorFromAutoevals 接入 autoevals。
 */
import "./instrumentation.mjs"; // 必须最先执行：先启动 OTEL，评测过程中产生的 trace 才能上报

import { LangfuseClient } from "@langfuse/client"; // 数据集 / 分数等管理 API 的客户端
import { CallbackHandler } from "@langfuse/langchain"; // 让每条用例的调用链也进 trace
import { createAgent, extractReply } from "./agent.mjs"; // 与 demo 共用同一个 Agent，评测才有代表性
import { shutdownTracing } from "./instrumentation.mjs";

/**
 * Dataset 名 = 评测集的「身份标识」：
 *   同名 → 继续往同一评测集追加/更新用例，历史 Run 可对比；改名 → 等于另起一套评测集。
 * 因此允许用环境变量覆盖，方便为不同模型 / 不同版本各建一套。
 */
const DATASET_NAME = process.env.LANGFUSE_DATASET_NAME ?? "deepagents-eval";

/** 本地种子用例；expectedOutput.contains 为需在回复中出现的关键词（不区分大小写） */
/**
 * upsert 语义：每条用例用固定 id（下面拼成 `${DATASET_NAME}:${item.id}`），
 * 反复运行只覆盖同 id 的 item，不会越跑越多 —— 所以脚本可以放心重复执行。
 *
 * expectedOutput 是自定义约定（框架只负责原样透传，不校验结构）：
 *   { contains: string[], minHits: number } —— contains 为期望关键词，minHits 为至少命中几个算通过
 * 用 minHits 而不是「全部命中」，是为了容忍措辞差异，避免假失败。
 */
const SEED_ITEMS = [
  {
    id: "weather-shanghai",
    input: "用工具查一下 Shanghai 的天气，直接告诉我结果。",
    // 关键词同时覆盖数字 / 中文城市名 / 英文城市名 / 天气描述：
    // 只要模型确实调了工具并用中文复述，至少能命中一个，容错更高
    expectedOutput: {
      contains: ["31", "上海", "shanghai", "闷热", "多云"],
      minHits: 1,
    },
    metadata: { case: "weather" }, // metadata 随 item 存储，可在 UI 里按场景筛选
  },
  {
    id: "weather-tokyo",
    input: "用工具查一下 Tokyo 的天气。",
    expectedOutput: {
      contains: ["28", "东京", "tokyo", "晴"],
      minHits: 1,
    },
    metadata: { case: "weather" },
  },
  {
    id: "calculate-sum",
    input: "用计算器把 31 和 28 相加，只告诉我结果。",
    // 唯一正确结果 59：验证加法确实由 calculate 工具完成，而不是模型心算
    expectedOutput: {
      contains: ["59"],
      minHits: 1,
    },
    metadata: { case: "calculate" },
  },
  {
    id: "weather-then-sum",
    // 端到端用例：两次 get_weather + 一次 calculate，考察多步工具编排能力
    input:
      "查一下 Shanghai 和 Tokyo 的天气，再用计算器把两地气温数字相加（31+28），最后总结。",
    // minHits=3：多步任务放宽到「命中 3 个以上」——
    // 既能挡住完全跑偏的回答，又不会因模型表述顺序/措辞不同而误判
    expectedOutput: {
      contains: ["31", "28", "59", "上海", "东京", "shanghai", "tokyo"],
      minHits: 3,
    },
    metadata: { case: "e2e" },
  },
];

/**
 * 幂等地准备评测集：
 *   1) 先尝试 create，失败且错误信息表示「已存在」时忽略，保证脚本可反复运行
 *   2) 再逐条 createItem 写入用例（固定 id 即 upsert）
 * 不先查再建，是为了省一次往返；「已存在」这一分支已在 catch 里覆盖。
 */
async function ensureDataset(langfuse) {
  try {
    await langfuse.api.datasets.create({
      name: DATASET_NAME,
      description: "Deep Agents 天气/计算工具评测集",
      metadata: { app: "langfuse-test", version: "1" }, // 备忘用元数据，方便日后辨认来源
    });
    console.log(`created dataset: ${DATASET_NAME}`);
  } catch (err) {
    // 已存在则忽略；不同版本服务端返回的文案/状态码不一致，用宽松匹配兜住 409 / conflict 等
    const msg = err?.message ?? String(err);
    if (!/already|exist|409|conflict/i.test(msg)) {
      console.warn(`dataset create warning: ${msg}`); // 其他错误只告警不中断，避免整轮评测白跑
    } else {
      console.log(`dataset exists: ${DATASET_NAME}`);
    }
  }

  for (const item of SEED_ITEMS) {
    // 固定 id → upsert；内容以本文件的定义为准（本地种子就是事实来源）
    await langfuse.dataset.createItem({
      datasetName: DATASET_NAME,
      id: `${DATASET_NAME}:${item.id}`,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: item.metadata,
    });
  }
  console.log(`upserted ${SEED_ITEMS.length} dataset items`);
}

/** 单条用例：跑 agent，返回最终回复字符串（作为 experiment output） */
/**
 * Task 函数：Langfuse 对「被测函数」的约定 —— 输入一个 dataset item，返回本次输出。
 * 返回的字符串会成为该 item 的 output，用于 evaluator 打分，并出现在 Experiment 结果表里。
 * 每次调用都新建 agent：用例之间不共享状态，保证互不污染（评测可信的前提）。
 */
async function runAgentTask(item) {
  const agent = createAgent();
  // input 理论上已是字符串；String() 兜底，防止 item 里塞了结构化数据导致 invoke 报错
  const query = typeof item.input === "string" ? item.input : String(item.input);

  /**
   * 每条用例单独一个 handler：
   *   - sessionId 统一为 eval-<dataset>，把整轮评测的 trace 聚到同一个 Session 下
   *   - traceMetadata 把 dataset / itemId / case 挂到 trace 上，
   *     这样在 UI 里能按「哪条用例」过滤 trace，把「评测分数」和「当时的完整调用链」对上
   */
  const handler = new CallbackHandler({
    sessionId: `eval-${DATASET_NAME}`,
    userId: "eval-runner",
    tags: ["deepagents", "evaluation"],
    traceMetadata: {
      dataset: DATASET_NAME,
      itemId: item.id,
      case: item.metadata?.case,
    },
  });

  const result = await agent.invoke(
    { messages: [{ role: "user", content: query }] },
    { callbacks: [handler], recursionLimit: 30 },
  );

  return extractReply(result); // 只把最终回复作为 output，中间步骤留给 trace 观察
}

/**
 * Item-level：检查回复是否包含足够多的期望关键词
 * expectedOutput: { contains: string[], minHits?: number }
 *
 * 打分语义：value 用 0 / 1（二值分数），comment 记录命中详情便于人工复核。
 * 文本与关键词都转小写再比对，避免 Shanghai / shanghai 这类大小写差异造成误判。
 */
async function keywordHitEvaluator({ output, expectedOutput }) {
  const text = String(output ?? "").toLowerCase();
  const needles = expectedOutput?.contains ?? [];
  const minHits = expectedOutput?.minHits ?? 1;
  const hits = needles.filter((k) => text.includes(String(k).toLowerCase()));
  const passed = hits.length >= minHits;

  return {
    name: "keyword_hit",
    value: passed ? 1 : 0, // 0/1 二值分数：UI 里可直接看通过率
    comment: passed
      ? `命中 ${hits.length}/${needles.length}：${hits.join(", ") || "—"}`
      : `未达 minHits=${minHits}，仅命中：${hits.join(", ") || "无"}`,
  };
}

/** Item-level：回复非空且有一定长度 */
/**
 * 兜底检查：防止「模型啥也没答」被 keyword_hit 记成「只是没命中关键词」而掩盖真实故障
 * （空回复通常意味着调用失败或提前终止，值得单独一个指标暴露）。
 * 阈值取 4：比「无」多一个字都算，只拦明显异常的空/超短输出。
 */
async function nonEmptyEvaluator({ output }) {
  const text = String(output ?? "").trim();
  const ok = text.length >= 4;
  return {
    name: "non_empty",
    value: ok ? 1 : 0,
    comment: ok ? `长度 ${text.length}` : "回复为空或过短",
  };
}

/** Run-level：keyword_hit 平均分 */
/**
 * Run 级 evaluator：拿到整轮所有 item 的结果 { itemResults }，
 * 常见用途就是聚合成一个「一键对比」的总分。
 *
 * itemResults[].evaluations[] 里是本轮每个 item 的评分记录，先展平、再按名字筛出 keyword_hit、
 * 过滤掉非有限数（如 null），最后求平均。
 * 一条分数都没有时返回 value: null —— Langfuse 会显示为「无分数」，而不是误导性的 0 分。
 */
async function averageKeywordHit({ itemResults }) {
  const scores = itemResults
    .flatMap((r) => r.evaluations ?? [])
    .filter((e) => e.name === "keyword_hit")
    .map((e) => Number(e.value))
    .filter((v) => Number.isFinite(v));

  if (scores.length === 0) {
    return { name: "avg_keyword_hit", value: null, comment: "无 keyword_hit 分数" };
  }

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    name: "avg_keyword_hit",
    value: avg,
    comment: `平均命中率 ${(avg * 100).toFixed(1)}%（${scores.length} 条）`,
  };
}

async function main() {
  // 管理 API 客户端：读写 Dataset、提交分数（trace 上报由 instrumentation.mjs 负责，互不冲突）
  const langfuse = new LangfuseClient();

  console.log("1) ensure dataset + seed items…");
  await ensureDataset(langfuse); // 幂等：已存在则跳过创建，用例按固定 id upsert

  console.log("2) run experiment on Langfuse dataset…");
  const dataset = await langfuse.dataset.get(DATASET_NAME); // 取托管数据集（默认取最新版本）

  /**
   * runExperiment：把「数据集 + task + evaluator」交给 Langfuse 编排，它负责：
   *   并发跑 task、自动 tracing、item 级 + run 级双层打分、单个用例失败不影响整轮。
   * 参数说明：
   *   - name / description：实验的展示信息
   *   - runName：本次 run 的名字（用时间戳，保证每次运行独立，便于在 UI 里对比不同 run）
   *   - task：被测函数（见 runAgentTask）
   *   - evaluators：item 级评分器数组
   *   - runEvaluators：run 级评分器数组（拿整轮结果聚合）
   *   - maxConcurrency: 1：Agent 调用较重且要打 trace，串行更稳、输出更易读；
   *     数据量大时可调大（如 5）来换吞吐
   *   - metadata：会附加到本轮产生的所有 trace 上（模型名等），方便按运行条件筛选
   */
  const result = await dataset.runExperiment({
    name: "Deep Agents Tool Eval",
    description: "天气查询 + 计算器工具调用评测",
    runName: `run-${new Date().toISOString().replace(/[:.]/g, "-")}`, // 时间戳去掉非法字符，作为唯一 run 名
    task: runAgentTask,
    evaluators: [keywordHitEvaluator, nonEmptyEvaluator],
    runEvaluators: [averageKeywordHit],
    maxConcurrency: 1, // agent 调用较重，串行更稳
    metadata: {
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      app: "langfuse-test",
    },
  });

  console.log("\n3) experiment result:\n");
  console.log(await result.format()); // format() 把本轮结果整理成可直接阅读的表格

  // flush 客户端的异步上报队列（数据集写入 / 分数提交），与 shutdownTracing 的 OTEL flush 是两件事，都要做
  await langfuse.flush();
  console.log(`\n完成。到 Langfuse → Datasets →「${DATASET_NAME}」→ Runs 查看对比。`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownTracing(); // 收尾：把 trace 刷完并关闭 OTEL SDK（失败路径同样执行）
  });
