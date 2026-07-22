/**
 * RunnableWithCallbacks - 通过 callbacks 观测 chain 执行过程
 * 
 * 在 .invoke() 时传入 callbacks 数组，监听 handleChainStart / handleChainEnd /
 * handleChainError 等生命周期事件。适合调试、日志记录、性能监控等场景。
 * chain.id 数组的最后一个元素是当前步骤的名称。
 * 
 * @see RunnableLambda.mjs         — 基础：被观测的 chain 本身由 lambda 组成
 */
import "dotenv/config";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";

// 文本处理链：清洗 → 分词 → 统计
const clean = RunnableLambda.from((text) => {
  return text.trim().replace(/\s+/g, " "); // 去除首尾空格，多个空格合并为单个
});

const tokenize = RunnableLambda.from((text) => {
  return text.split(" "); // 按空格切分为单词数组
});

const count = RunnableLambda.from((tokens) => {
  return { tokens, wordCount: tokens.length }; // 统计单词数量
});

// 数据流向："  hello   world..." → trim → "hello world from langchain" → split → ["hello","world",...] → count → {tokens, wordCount}
const chain = RunnableSequence.from([
  clean,      // 1. 清洗：去除多余空格
  tokenize,   // 2. 分词：按空格切分
  count,      // 3. 统计：计算单词数量
]);

// callbacks 对象：监听 chain 每一步的生命周期事件
const callback = {
  handleChainStart(chain) {
    const step = chain?.id?.[chain.id.length - 1] ?? "unknown";
    console.log(`[START] ${step}`);  // 每个 Runnable 开始时触发，chain.id 最后一项是当前步骤名
  },
  handleChainEnd(output) {
    console.log(`[END]   output=${JSON.stringify(output)}\n`); // 每个 Runnable 结束时触发，打印输出
  },
  handleChainError(err) {
    console.log(`[ERROR] ${err.message}\n`); // 任意步骤出错时触发
  },
};

// 执行 chain，传入 callbacks 监听每一步
const result = await chain.invoke("  hello   world   from   langchain  ", {
  callbacks: [callback],
});

console.log("结果:", result);
