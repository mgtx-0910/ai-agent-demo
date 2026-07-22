/**
 * RunnableBranch - 条件分支路由，类似 if/else if/else
 * 
 * RunnableBranch.from([[condition, handler], ..., defaultHandler]) 按顺序
 * 检查条件函数，第一个返回 true 的条件对应的 handler 被执行。最后一个参数
 * 是无条件的默认处理器。适合根据输入内容走不同处理路径。
 * 
 * @see RouterRunnable.mjs         — 对比：按 key 路由而非按条件函数
 * @see cases/mcp-test.mjs         — 实战：ReAct Agent 中的工具调用分支
 */
import 'dotenv/config';
import { RunnableBranch, RunnableLambda } from "@langchain/core/runnables";

// 条件判断函数（按顺序匹配，第一个返回 true 的条件对应的 handler 被执行）
const isPositive = RunnableLambda.from((input) => input > 0);
const isNegative = RunnableLambda.from((input) => input < 0);
const isEven = RunnableLambda.from((input) => input % 2 === 0);

// 各分支的处理函数
const handlePositive = RunnableLambda.from((input) => `正数: ${input} + 10 = ${input + 10}`);
const handleNegative = RunnableLambda.from((input) => `负数: ${input} - 10 = ${input - 10}`);
const handleEven = RunnableLambda.from((input) => `偶数: ${input} * 2 = ${input * 2}`);
const handleDefault = RunnableLambda.from((input) => `默认: ${input}`);

// 创建 RunnableBranch：按 [正数, 负数, 偶数, 默认] 顺序匹配
// 输入 5: isPositive=true → handlePositive
// 输入 -3: isPositive=false → isNegative=true → handleNegative
// 输入 4: isPositive=true → handlePositive（偶数分支不会走到，因为正数先匹配）
// 输入 0: 三个条件都为 false → handleDefault
const branch = RunnableBranch.from([
    [isPositive, handlePositive],
    [isNegative, handleNegative],
    [isEven, handleEven],
    handleDefault   // 兜底：前面的条件都不满足时执行
]);

// 测试不同的输入
const testCases = [5, -3, 4, 0];

for (const testCase of testCases) {
    const result = await branch.invoke(testCase);
    console.log(`输入: ${testCase} => ${result}`);
}
