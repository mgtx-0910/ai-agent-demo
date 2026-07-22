/**
 * RunnableWithFallbacks - 失败时切换到备用 Runnable（降级/兜底）
 * 
 * .withFallbacks({ fallbacks: [backupRunnable] }) 当主 Runnable 执行失败时，
 * 自动尝试 fallback 列表中的备用 Runnable，依次尝试直到成功或全部失败。
 * 适用于 API 不稳定、模型切换等容灾场景。
 * 
 * @see RunnableWithRetry.mjs      — 对比：重试同一 Runnable 而非切换备用
 */
import "dotenv/config";
import { RunnableLambda } from "@langchain/core/runnables";

// 三个翻译服务，优先级从高到低，依次降级

// 高级翻译：模拟第三方 API（高质但可能超时）
const premiumTranslator = RunnableLambda.from(async (text) => {
  console.log("[Premium] 尝试翻译...");
  // 模拟高级服务不可用（抛异常触发 fallback）
  throw new Error("Premium 服务超时");
});

// 标准翻译：模拟另一 API（比高级差，但也可能失败）
const standardTranslator = RunnableLambda.from(async (text) => {
  console.log("[Standard] 尝试翻译...");
  // 模拟标准服务也挂了
  return "xxx";
  // throw new Error("Standard 服务限流");
});

// 本地翻译：兜底方案（词典映射，稳定但能力有限）
const localTranslator = RunnableLambda.from(async (text) => {
  console.log("[Local] 使用本地词典翻译...");
  const dict = { hello: "你好", world: "世界", goodbye: "再见" };
  const words = text.toLowerCase().split(" ");
  return words.map((w) => dict[w] ?? w).join("");
});

// withFallbacks 配置：主服务失败时依次尝试备用
// 执行顺序：premiumTranslator.invoke() → 失败 → standardTranslator → 失败 → localTranslator
const translator = premiumTranslator.withFallbacks({
  fallbacks: [standardTranslator, localTranslator],
});

// 最终由 localTranslator 兜底完成翻译
const result = await translator.invoke("hello world");
console.log("翻译结果:", result);
