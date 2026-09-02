/**
 * middleware-test2.mjs —— LangChain 自定义 Middleware 实验②：注册工具 + 包装工具调用
 *
 * 与 middleware-test.mjs 互补，演示 createMiddleware 对工具侧的扩展能力：
 *   - tools: [...]     —— 中间件可以额外给 Agent 注册工具（无需在 createAgent 里声明）
 *   - wrapToolCall     —— 包裹一次工具执行：调用前打日志、调用后改写 ToolMessage 内容
 *   - 借助 ToolMessage 修改 + Command.update 把中间件自己的状态（toolInvocationCount）写回图状态
 *
 * 运行方式：
 *   node src/middleware-test2.mjs
 *
 * 前置条件：.env 已配置模型相关环境变量
 */
import "dotenv/config"; // 加载 .env 到 process.env
import { Command } from "@langchain/langgraph"; // Command：从钩子内以命令方式更新状态/跳转
import { z } from "zod"; // Zod：工具参数 schema
import { ChatOpenAI } from "@langchain/openai"; // 对话模型（OpenAI 兼容协议）
import {
  createAgent,
  createMiddleware,
  HumanMessage,
  ToolMessage,
  tool,
} from "langchain"; // tool 包装函数为模型可调用工具；ToolMessage 为工具结果消息

// 一个普通工具：返回当前 UTC 时间（此工具不在 createAgent.tools 里注册，而由中间件注入）
const getCurrentTime = tool(() => new Date().toISOString(), {
  name: "get_current_time",
  description: "返回当前 UTC 时间的 ISO 8601 字符串",
  schema: z.object({}), // 无参数：空对象 schema
});

/** 通过 middleware 注册工具，并用 wrapToolCall 包装执行 */
const extendedToolsMiddleware = createMiddleware({
  name: "ExtendedToolsMiddleware",
  stateSchema: z.object({
    toolInvocationCount: z.number().default(0), // 统计中间件实际包装过的工具调用次数
  }),
  tools: [getCurrentTime], // 关键点①：工具在这里注册，而非 createAgent 时
  wrapToolCall: async (request, handler) => {
    // request：本次工具调用上下文（tool、toolCall 参数、当前 state 等）
    const toolName = request.tool?.name ?? request.toolCall.name;
    console.log(
      `[Tools] 即将执行: ${toolName}`,
      "args:",
      request.toolCall.args ?? {}
    );
    const result = await handler(request); // 关键点②：放行给真正的工具执行
    if (!ToolMessage.isInstance(result)) return result; // 非工具结果消息（如跳转指令）原样返回

    // 改写工具结果：在原始内容后追加一行包装标记，演示"结果可被中间件加工"
    const wrapped = new ToolMessage({
      content: `${result.content}\n[wrapToolCall] 已由 ExtendedToolsMiddleware 包装`,
      tool_call_id: result.tool_call_id,
      name: result.name,
    });
    console.log(
      `[Tools] 执行完成: ${toolName}`,
      typeof wrapped.content === "string"
        ? wrapped.content.slice(0, 120)
        : wrapped
    );
    // 关键点③：返回 Command 把加工后的消息写回图状态，并累加自己的计数器
    return new Command({
      update: {
        toolInvocationCount: request.state.toolInvocationCount + 1,
        messages: [wrapped],
      },
    });
  },
  afterAgent: (state) => {
    // Agent 收尾：打印中间件视角统计的工具调用次数
    console.log(
      `[Tools] agent 结束，middleware 统计工具调用: ${state.toolInvocationCount} 次`
    );
  },
});

// 模型实例
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  temperature: 0,
});

// 组装 Agent：tools 为空数组，get_current_time 由 middleware 注入
const agent = createAgent({
  model,
  tools: [],
  systemPrompt:
    "你是一个助手。",
  middleware: [extendedToolsMiddleware],
});

// 让模型调用时间工具，观察 wrapToolCall 日志与包装后的返回内容
for (const text of [
  "给我当前时间",
]) {
  console.log("\n用户:", text);
  // invoke 返回值同样带中间件声明的 state 字段 toolInvocationCount
  const { messages, toolInvocationCount } = await agent.invoke({
    messages: [new HumanMessage(text)],
  });
  console.log("回复:", messages.at(-1)?.content);
  console.log("toolInvocationCount:", toolInvocationCount);
}
