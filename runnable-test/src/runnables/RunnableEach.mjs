/**
 * RunnableEach - 对数组中的每个元素独立执行同一个 Runnable
 * 
 * 输入为数组时，RunnableEach 对每个元素调用 bound Runnable 并收集结果。
 * 类似 Array.map() 但以 Runnable 形式实现，可嵌入 RunnableSequence 中。
 * 
 * @see RunnableLambda.mjs         — 基础：单元素的 Runnable 包装
 */
import 'dotenv/config';
import { RunnableEach, RunnableLambda, RunnableSequence } from "@langchain/core/runnables";

// 单元素处理链：字符串 → 转大写 → 加问候语
const toUpperCase = RunnableLambda.from((input) => input.toUpperCase());
const addGreeting = RunnableLambda.from((input) => `你好，${input}！`);

const processItem = RunnableSequence.from([
  toUpperCase,    // 1. "alice" → "ALICE"
  addGreeting,    // 2. "ALICE" → "你好，ALICE！"
]);

// 使用 RunnableEach 对数组中的每个元素应用同一个 chain（等效于 Array.map）
// 输入: ["alice", "bob", "carol"] → 每个元素都经过 processItem 处理
const chain = new RunnableEach({
  bound: processItem,  // 绑定的 Runnable，对数组每个元素独立执行
});

const input = ["alice", "bob", "carol"];

// 输出: ["你好，ALICE！", "你好，BOB！", "你好，CAROL！"]
const result = await chain.invoke(input);

console.log('✅ RunnableEach - 数组元素处理:');
console.log('输入:', input);
console.log('输出:', result);
