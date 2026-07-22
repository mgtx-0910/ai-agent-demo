/**
 * RunnableWithRetry - 执行失败时自动重试
 * 
 * .withRetry({ stopAfterAttempt: N }) 在 Runnable 执行失败时自动重试 N-1 次。
 * 与 RunnableWithFallbacks 的区别：retry 是「再来一次同一个 Runnable」，
 * fallback 是「换一个备用 Runnable 执行」。
 * 
 * @see RunnableWithFallbacks.mjs  — 对比：切换备用 Runnable 而非重试同一
 */
import "dotenv/config";
import { RunnableLambda } from "@langchain/core/runnables";

let attempt = 0;

// 模拟一个不稳定的服务：70% 概率失败，用来演示 withRetry 的自动重试
const unstableRunnable = RunnableLambda.from(async (input) => {
  attempt += 1;
  console.log(`第 ${attempt} 次尝试，输入: ${input}`);

  // 模拟 70% 概率失败的随机错误
  if (Math.random() < 0.7) {
    console.log("本次尝试失败，抛出错误。");
    throw new Error("模拟的随机错误");
  }

  console.log("本次尝试成功。");
  return `成功处理: ${input}`;
});

// 使用 withRetry 包装：失败时自动重试，最多尝试 5 次（含首次）
const runnableWithRetry = unstableRunnable.withRetry({
  stopAfterAttempt: 5  // 首次 + 最多 4 次重试
});

try {
  const result = await runnableWithRetry.invoke("演示 withRetry");
  console.log("✅ 最终结果:", result);
} catch (err) {
  console.error("❌ 重试多次后仍然失败:", err?.message ?? err);
}

