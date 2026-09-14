/**
 * instrumentation.mjs —— OpenTelemetry + Langfuse 埋点初始化（全链路第一步）
 *
 * 必须**最先被加载**：index.mjs / evaluate.mjs 的第一行 import 的就是本文件。
 * Langfuse 靠 OTEL 的 SpanProcessor 导出 span，只有在会被自动埋点的库（LangChain /
 * OpenAI SDK）被 import 之前完成注册，才能接管它们后续产生的 span。
 *
 * 本文件只做三件事：加载 .env → 创建 LangfuseSpanProcessor → 注册进 NodeSDK 并 start()。
 *
 * 导出：
 *   - langfuseSpanProcessor：收尾时用它 forceFlush()
 *   - shutdownTracing()：flush + 关闭 SDK，脚本退出前必须调用
 */
import "dotenv/config"; // 副作用导入：执行即把 .env 写进 process.env
import { NodeSDK } from "@opentelemetry/sdk-node"; // OTEL 在 Node 侧的 SDK 装配入口
import { LangfuseSpanProcessor } from "@langfuse/otel"; // Langfuse 的 span 导出器

/**
 * .env 里的 LANGCHAIN_CALLBACKS_BACKGROUND 是 **LangChain 自己的开关**（由 @langchain/core 读取，
 * 不是 Langfuse 变量，本项目代码也不引用它），所以上面的 dotenv 导入必须先于 LangChain：
 *   - true（LangChain 默认）：回调后台异步派发，await invoke() 返回时不保证 span 已写完
 *   - false（本项目）        ：invoke 返回前 await 完所有回调，「返回」即「trace 数据就绪」
 * index.mjs / evaluate.mjs 是跑完即退出的短脚本，收尾要立刻 shutdownTracing()；若为 true，
 * flush 时后台回调还没把 span 送出，Langfuse 里就会丢 trace 或只剩前半截。
 * 它只管 LangChain 回调通道；OTEL 通道由收尾的 forceFlush() 负责 —— 两条通道都要收尾。
 */
const baseUrl = process.env.LANGFUSE_BASE_URL; // 唯一的「span 发往哪个实例」开关

// span 导出器：OTEL 采集到的 span 先进入它，再由它发往 Langfuse。
// 显式传入参数（而非只靠环境变量）是为了让「发到哪个实例」在代码里一目了然，便于排查。
export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY, // pk-lf-xxx
  secretKey: process.env.LANGFUSE_SECRET_KEY, // sk-lf-xxx
  baseUrl, // Cloud: https://cloud.langfuse.com；自建（docker-compose.yml）: http://localhost:3000
  exportMode: "immediate", // span 一结束就导出，适合短脚本；默认 "batched" 适合长驻服务
});

// NodeSDK 是 OTEL 在 Node.js 的装配台：start() 之后 CallbackHandler 产生的 span 才会被采集并导出。
// spanProcessors 是数组，可同时挂多个后端（例如再加一个控制台 exporter 做本地调试）。
const sdk = new NodeSDK({ spanProcessors: [langfuseSpanProcessor] });
sdk.start();

// 启动即打印上报目标，避免「.env 还留着 cloud 地址、却以为连的是 localhost」；仅按 host 粗略识别。
const targetLabel = /localhost|127\.0\.0\.1/i.test(baseUrl ?? "") ? "本地自建实例" : "远端 / Langfuse Cloud";
console.log(`[langfuse] 上报目标: ${baseUrl ?? "(未设置，SDK 默认)"} → ${targetLabel}`);

/**
 * 脚本收尾：所有 trace 产生之后、进程退出之前调用。
 * forceFlush() 把缓冲区里未发出的 span 推完，sdk.shutdown() 关闭 SDK、释放后台定时器与连接。
 * 漏掉这一步的典型现象：Langfuse 里看不到 trace，或 trace 只有前半截。
 */
export async function shutdownTracing() {
  await langfuseSpanProcessor.forceFlush();
  await sdk.shutdown();
}
