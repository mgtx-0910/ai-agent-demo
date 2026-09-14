/**
 * index.mjs —— 单次调用 Demo：跑一遍 Agent，并把全过程 trace 到 Langfuse
 *
 * 这是「最小可运行」的观测例子，完整链路：
 *   instrumentation（启动 OTEL）
 *     → createAgent（deepagents）
 *     → CallbackHandler（LangChain 回调 → Langfuse span 的桥）
 *     → invoke（模型 / 工具多轮循环）
 *     → shutdownTracing（flush + 关闭）
 *
 * 第一行 import 必须最先执行：它负责启动 OTEL，详见 instrumentation.mjs 顶部说明。
 */
import "./instrumentation.mjs"; // 必须第一个执行：先铺好 OTEL 管道，后面的调用才能被采集

import { CallbackHandler } from "@langfuse/langchain"; // LangChain ↔ Langfuse 的适配器
import { createAgent, extractReply } from "./agent.mjs"; // 与被评测脚本共用的 Agent 工厂
import { shutdownTracing } from "./instrumentation.mjs"; // 收尾：flush + 关闭 SDK

/**
 * 特意设计成「两次工具调用 + 一次汇总」的问题：
 * 单次 invoke 内部会经历 查天气 → 查天气 → 数值相加 → 总结 的多步循环，
 * 在 Langfuse 时间线上能直观看到 ReAct 式多次 LLM / Tool 调用的嵌套层级与各自耗时，
 * 比只问一句话更能体现 trace 的价值。
 */
const QUERY =
  "查一下 Shanghai 和 Tokyo 的天气，再用计算器把两地气温数字相加（31+28），最后总结。";

async function main() {
  const agent = createAgent(); // 每次新建实例，状态独立

  /**
   * CallbackHandler：把 LangChain 的回调事件（LLM 调用 / 工具调用 / 链执行）转成 Langfuse 的 trace 结构。
   * 三个可选元数据决定 trace 在 UI 里怎么被找到：
   *   - sessionId：会话 ID，多次运行聚合到同一个 Session（UI 的 Sessions 视图按它分组）
   *   - userId：调用方标识，便于按用户筛选与统计
   *   - tags：标签，UI 里可按标签过滤（本 demo 统一打 deepagents）
   */
  const langfuseHandler = new CallbackHandler({
    sessionId: "deepagents-demo",
    userId: "local-dev",
    tags: ["deepagents"],
  });

  console.log("running:", QUERY);

  // 关键：callbacks 挂上 Langfuse，LLM / tool 调用才会进 trace
  /**
   * invoke 跑完整个 Agent 循环，参数说明：
   *   - messages：把用户消息作为初始状态传入
   *   - callbacks：必须显式挂 handler，否则这次运行不会产生 trace ——
   *     instrumentation.mjs 只是「铺好管道」，真正产生 span 的是 CallbackHandler
   *   - recursionLimit: 30：多轮工具循环的安全阀（默认值偏小），
   *     多步任务设太小容易抛 GraphRecursionError；30 对本 demo 绰绰有余
   */
  const result = await agent.invoke(
    { messages: [{ role: "user", content: QUERY }] },
    { callbacks: [langfuseHandler], recursionLimit: 30 },
  );

  console.log("\nreply:", extractReply(result));

  // last_trace_id 由 handler 在运行过程中回填；打印出来可直接在 Langfuse UI 搜索该 id 定位本次 trace
  if (langfuseHandler.last_trace_id) {
    console.log("\ntrace id:", langfuseHandler.last_trace_id);
  }
}

main()
  .catch((err) => {
    // 先把错误暴露出来，再交给 finally 收尾（不要把异常吞掉）
    console.error(err);
    process.exitCode = 1; // 用退出码标记失败，方便 shell / CI 判断
  })
  .finally(() => shutdownTracing()); // 无论成功失败都要 flush 并关闭 OTEL，否则 trace 可能丢
