// ============================================================================
// src/todo-middleware-test.mjs — todoListMiddleware 行为验证脚本
//
// 目的：独立验证 langchain 的 todoListMiddleware 中间件——
// 当模型收到需要多步规划的请求时，应调用 write_todos 生成中文执行步骤，
// 并将 todos 一并输出到最终结果中。
//
// 运行：node src/todo-middleware-test.mjs
// 依赖 .env 中的 OPENAI_API_KEY / OPENAI_MODEL / OPENAI_BASE_URL
// ============================================================================
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import {
  createAgent,
  HumanMessage,
  todoListMiddleware,
} from "langchain";

// 基于环境变量构建语言模型（qwen-plus 等兼容 OpenAI 协议的模型均可）
const model = new ChatOpenAI({
  model: process.env.OPENAI_MODEL,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  }
});

// 注册中间件后的 Agent：无外部工具，只验证 write_todos 与规划能力
const agent = createAgent({
  model,
  tools: [],
  systemPrompt:
    "你是生活规划助手。收到需要多步完成的请求时，先用 write_todos 列出中文执行步骤，然后简要说明你的计划。",
  middleware: [todoListMiddleware()],
});

// 测试用例：需要拆解成多步规划的生活类请求
const query =
  "我下周末想带爸妈去杭州玩两天，帮我规划一下：交通怎么选、住哪里方便、必去景点和吃什么，预算控制在人均 1500 元左右。";

const result = await agent.invoke({
  messages: [new HumanMessage(query)],
});

// 打印模型生成的 todo 列表与最终回复
console.log("todos:", JSON.stringify(result.todos, null, 2));
console.log("─".repeat(50));
console.log("回复:", result.messages.at(-1)?.content);
