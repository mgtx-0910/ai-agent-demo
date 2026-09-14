/**
 * instrumentation.mjs —— OpenTelemetry + Langfuse 埋点初始化（全链路第一步）
 *
 * 位置要求：必须「最先被加载」。index.mjs / evaluate.mjs 的第一行都是 import "./instrumentation.mjs"。
 * 原因：Langfuse 是通过 OTEL 的 SpanProcessor 把 span 导出出去的；只有在业务代码
 * （LangChain / OpenAI SDK 这类会被自动埋点的库）被 import 之前完成注册，
 * OTEL 才能接管它们后续产生的 span —— 晚注册就会漏掉早期 span。
 *
 * 本文件做三件事：
 *   1. 加载 .env（拿到 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL，
 *      以及决定回调派发时机的 LANGCHAIN_CALLBACKS_BACKGROUND —— 见下方 import 处注释）
 *   2. 创建 LangfuseSpanProcessor：决定 span 发往哪个 Langfuse 实例、以什么节奏发
 *   3. 注册到 NodeSDK 并 start()：启动 OTEL 的全局 TracerProvider
 *
 * 导出：
 *   - langfuseSpanProcessor：收尾时用它 forceFlush() 把缓冲区里的 span 推完
 *   - shutdownTracing()：flush + 关闭 SDK，脚本退出前必须调用
 */
/**
 * dotenv/config 是副作用导入：执行即把 .env 写进 process.env（本文件不导出任何东西）。
 *
 * 顺序很关键：必须早于 LangChain / Langfuse 的 import，因为 .env 里的
 * LANGCHAIN_CALLBACKS_BACKGROUND 是 **LangChain 自己的开关**（由 @langchain/core 构造
 * CallbackManager 时读取，本项目代码并不显式引用它，也不是 Langfuse 的变量）：
 *   - true（LangChain 默认值）：回调走「后台异步派发」。await agent.invoke({ callbacks })
 *     返回时只代表主流程跑完，并不保证 CallbackHandler 已把所有 span end 掉并派发出去，
 *     它们还在后台队列里继续执行。好处是不阻塞主调用链，适合高并发常驻服务。
 *   - false（本项目 .env 的设置）：invoke 返回前会 await 完所有回调 handler，
 *     所以「invoke 返回」就等于「trace 数据已就绪」。
 *
 * 为什么本项目必须设 false：index.mjs / evaluate.mjs 都是跑完即退出的短脚本，
 * 收尾要立刻执行下面的 shutdownTracing()（forceFlush + shutdown）。若保持默认 true，
 * 主流程刚结束就去 flush，而后台回调还没来得及把 span 交出去，Langfuse 里就会出现
 * trace 缺失、或 trace 只有前半截这类偶发丢数据现象。
 *
 * 注意：该变量只管「LangChain 回调」这条通道；OTEL 通道（下面的 LangfuseSpanProcessor）
 * 不受它影响，那条路由收尾时的 forceFlush() 负责。两条通道独立，收尾都要做。
 */
import "dotenv/config";
import { NodeSDK } from "@opentelemetry/sdk-node"; // OTEL 在 Node 侧的 SDK 装配入口
import { LangfuseSpanProcessor } from "@langfuse/otel"; // Langfuse 的 span 导出器

/**
 * span 导出器：所有被 OTEL 采集到的 span 先进入它，再由它发往 Langfuse。
 *
 * 构造参数：
 *   - publicKey / secretKey：Langfuse 项目的 pk-lf-xxx / sk-lf-xxx
 *   - baseUrl：Langfuse 实例地址 —— Cloud 用 https://cloud.langfuse.com；
 *     本地自建（本目录 docker-compose.yml，web 端口 3000）用 http://localhost:3000
 *   这里显式传入而不是只依赖环境变量，是为了让「发到哪个实例」在代码里一目了然，方便排查。
 *   （官方文档主推无参构造 + 环境变量；两种方式等价，环境变量名固定为 LANGFUSE_BASE_URL。）
 */
export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL,
  // "immediate"：span 结束就尽快导出，适合短脚本；默认 "batched" 适合长驻服务
  exportMode: "immediate",
});

/**
 * NodeSDK 是 OTEL 在 Node.js 的「总装配台」：
 * 把上面的 processor 注册进全局 TracerProvider；start() 之后，
 * @langfuse/langchain 的 CallbackHandler 产生的 span 才会被采集并导出到 Langfuse。
 * spanProcessors 是数组 —— 意味着可以同时挂多个后端（例如再加一个控制台 exporter 做本地调试）。
 */
const sdk = new NodeSDK({
  spanProcessors: [langfuseSpanProcessor],
});
sdk.start();

/**
 * 脚本收尾：必须在所有 trace 产生之后、进程退出之前调用。
 *   1. forceFlush()：把 processor 缓冲区里尚未发出的 span 强制推完
 *   2. sdk.shutdown()：关闭 OTEL SDK，释放后台定时器与连接
 * 漏掉这一步的典型现象：Langfuse 控制台看不到 trace，或 trace 只有前半截。
 * index.mjs / evaluate.mjs 都写成 main().finally(shutdownTracing)，保证异常退出时也能收尾。
 */
export async function shutdownTracing() {
  await langfuseSpanProcessor.forceFlush();
  await sdk.shutdown();
}
