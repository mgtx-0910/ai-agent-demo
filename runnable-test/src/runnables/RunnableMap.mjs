/**
 * RunnableMap - 并行执行多个 Runnable，合并结果为一个对象
 * 
 * RunnableMap.from({ key: runnable, ... }) 对同一个 input 并行执行所有子 Runnable，
 * 各子 Runnable 的输出按 key 合并到一个对象中。适用于同时做多件事（计算+格式化等）。
 * 注意：所有子 Runnable 都接收同一个原始 input，各自独立运行。
 * 
 * @see RunnableLambda.mjs         — 基础：单个函数的 Runnable 包装
 * @see RunnablePassthrough.mjs    — 对比：透传原输入并追加新字段
 */
import 'dotenv/config';
import { RunnableMap, RunnableLambda } from "@langchain/core/runnables";
import { PromptTemplate } from "@langchain/core/prompts";

// 数学运算 lambda（都接收同一个 input，各自从 input.num 取值）
const addOne = RunnableLambda.from((input) => input.num + 1);
const multiplyTwo = RunnableLambda.from((input) => input.num * 2);
const square = RunnableLambda.from((input) => input.num * input.num);

// prompt 模板（从同一个 input 中分别取 {name} 和 {weather}）
const greetTemplate = PromptTemplate.fromTemplate("你好，{name}！");
const weatherTemplate = PromptTemplate.fromTemplate("今天天气{weather}。");

// 创建 RunnableMap：对同一个 input 并行执行所有子 Runnable，按 key 合并输出
const runnableMap = RunnableMap.from({
    // 数学运算分支（都依赖 input.num）
    add: addOne,          // 1a. 并行：num + 1
    multiply: multiplyTwo,// 1b. 并行：num × 2
    square: square,       // 1c. 并行：num²
    
    // prompt 格式化分支（分别依赖 input.name / input.weather）
    greeting: greetTemplate, // 1d. 并行："你好，{name}！"
    weather: weatherTemplate, // 1e. 并行："今天天气{weather}。"
});

// 测试输入：包含所有分支需要的字段 {name, weather, num}
const input = {
    name: "神光",
    weather: "多云",
    num: 5,
};

// 执行：5 个 Runnable 同时运行，最终输出 { add, multiply, square, greeting, weather }
const result = await runnableMap.invoke(input);
console.log(result);
