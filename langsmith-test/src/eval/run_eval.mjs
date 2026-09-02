/**
 * run_eval.mjs —— RAG 评测入口：数据集 + RAG Agent + 三个评测器 → LangSmith
 *
 * 流程：
 *   1. 从 LangSmith 读取数据集 rag-eval-v1（由 build_dataset.mjs 创建）
 *   2. 逐条把样例的 question 喂给被测函数 runRagAgent（内部走 rag_agent.mjs 的 ask()）
 *   3. 对每个 Agent 输出跑三个评测器（evaluators.mjs）：忠实度 / 有用性 / 检索相关性
 *   4. 结果上报 LangSmith，每次运行生成一个 experiment（带实验名，便于横向对比模型/参数）
 *
 * 运行：npm run eval:run  （或 node src/eval/run_eval.mjs）
 * 前置：已执行 npm run eval:dataset 建好数据集
 */
import "dotenv/config"; // 加载 .env 到 process.env
import { Client } from "langsmith"; // LangSmith SDK：读取数据集、上报结果
import { evaluate } from "langsmith/evaluation"; // 评测驱动：跑数据 + 打分 + 上报
import { ask } from "../rag_agent.mjs"; // 被测对象：RAG Agent 问答入口
import { ragEvaluators } from "./evaluators.mjs"; // 三个评测器

/** 数据集名称（与 build_dataset.mjs 保持一致） */
const DATASET_NAME = "rag-eval-v1";
/** LangSmith 客户端：上报评估结果与追踪（开启 LANGCHAIN_TRACING_V2 后也记录每次调用链） */
const client = new Client({ apiKey: process.env.LANGCHAIN_API_KEY });

/**
 * 被评测的 RAG Agent
 *
 * evaluate() 会为数据集每条样例调用本函数，传入样例的 inputs。
 * 返回结构是评测器的输入契约：
 *   - answer：Agent 最终回答（忠实度/有用性评测用）
 *   - context：召回片段纯文本数组（忠实度/检索相关性评测用，判断是否有据可依）
 *
 * 注意：把 Document 对象拍平成纯文本，是因为评测器（LLM-Judge）只需要文本即可判断，
 * 且跨运行序列化更稳定。
 * @param {{question: string}} inputs 样例输入
 * @returns {Promise<{answer: string, context: string[]}>} Agent 输出
 */
async function runRagAgent(inputs) {
  const { answer, context } = await ask(inputs.question);
  return {
    answer,
    context: context.map((d) => d.pageContent), // Document[] → string[]
  };
}

async function main() {
  // evaluate() 三要素：被测函数 / 数据源 / 评测器数组
  const result = await evaluate(runRagAgent, {
    data: DATASET_NAME, // 按数据集名读取（也支持传 Dataset 对象）
    evaluators: ragEvaluators, // 三个 RAG 指标一起注册
    client, // 指定上报客户端
    experimentPrefix: `rag-openevals-${process.env.MODEL_NAME ?? "qwen"}`, // 实验名前缀，便于识别用哪个模型跑的
    maxConcurrency: 2, // 并发上限：评测涉及多次 LLM 调用，控制速率避免限流/超预算
  });

  // evaluate() 返回异步可迭代对象：不 drain 完不会真正跑完
  for await (const _row of result) {
    /* drain：逐条消费结果，等待全部样例评测完成 */
  }

  const project = process.env.LANGCHAIN_PROJECT ?? "default";
  console.log("✅ 评测完成");
  console.log("实验名:", result.experimentName); // LangSmith 中唯一定位这次实验
  console.log(
    "指标: rag_groundedness | rag_helpfulness | rag_retrieval_relevance",
  );
  // 报告入口：在 LangSmith 里查看每条样例的分数与失败原因
  console.log(
    `报告: https://smith.langchain.com/o/default/projects/p/${encodeURIComponent(project)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
