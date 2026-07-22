/**
 * RouterRunnable - 根据 key 动态路由到指定 Runnable
 * 
 * 输入格式为 { key: "runnableName", input: ... }，RouterRunnable 根据 key
 * 从注册表中查找对应的 Runnable 并执行。与 RunnableBranch 不同：RouterRunnable
 * 按名称显式路由，RunnableBranch 按条件函数自动判断。
 * 
 * @see RunnableBranch.mjs         — 对比：按条件函数自动路由
 */
import 'dotenv/config';
import { RouterRunnable, RunnableLambda } from "@langchain/core/runnables";

// 定义两个可路由的处理函数
const toUpperCase = RunnableLambda.from((text) => text.toUpperCase());
const reverseText = RunnableLambda.from((text) => text.split("").reverse().join(""));

// 创建 RouterRunnable：注册 runnables 表，按 key 路由
const router = new RouterRunnable({
  runnables: {
    toUpperCase,  // 大写转换
    reverseText,  // 字符串反转
  },
});

// 测试：调用 reverseText（输入必须包含 { key: "reverseText", input: ... }）
const result1 = await router.invoke({ key: "reverseText", input: "Hello World" });
console.log('reverseText 结果:', result1);

// 测试：调用 toUpperCase
const result2 = await router.invoke({ key: "toUpperCase", input: "Hello World" });
console.log('toUpperCase 结果:', result2);
