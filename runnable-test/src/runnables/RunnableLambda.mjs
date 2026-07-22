/**
 * RunnableLambda - 把普通函数包装成 Runnable
 * 
 * RunnableLambda.from(fn) 将任意 async/sync 函数转换为 Runnable，使其可参与
 * RunnableSequence 串联和 .pipe() 链式调用。核心价值：让自定义逻辑与 LangChain
 * 内置组件（PromptTemplate、ChatModel 等）无缝组合。
 * 
 * 示例：addOne → multiplyTwo → addOne 三个 lambda 串联，输入 5 输出 13
 * 
 * @see RunnableMap.mjs            — 对比：并行执行多个 Runnable
 * @see RunnableWithConfig.mjs     — 进阶：lambda 中通过 config 参数获取配置
 */
import 'dotenv/config';
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";

// 数据流向：输入数字 → +1 → ×2 → +1 → 最终结果
// 示例：输入 5 → 5+1=6 → 6×2=12 → 12+1=13
const addOne = RunnableLambda.from((input) => {
    console.log(`输入: ${input}`);
    return input + 1;
});

const multiplyTwo = RunnableLambda.from((input) => {
    console.log(`输入: ${input}`);
    return input * 2;
});

const chain = RunnableSequence.from([
    addOne,         // 1. 输入 + 1
    multiplyTwo,    // 2. 结果 × 2
    addOne          // 3. 结果 + 1
]);

// 执行：5 → 6 → 12 → 13
const result = await chain.invoke(5);
console.log(result);
