/**
 * 多智能体 Supervisor（主管-下属）模式演示 —— 串行路由版
 *
 * 为什么有这个版本：
 *   createSupervisor 依赖模型遵守 `parallel_tool_calls: false` 参数来避免
 *   一次并行调用多个子代理；但 DeepSeek 等 OpenAI 兼容接口会忽略该参数，
 *   一次返回多个 tool_calls，而 LangGraph 对子图返回的多个 PARENT Command
 *   只处理第一个，导致 ToolMessage 缺失、后续调用 LLM 报 400。
 *
 * 本版本改用「结构化输出」做路由：
 *   - 让模型输出 { next: "weather_agent" | "trivia_agent" | "FINISH" }
 *   - 天然一次只选一个子代理，与模型是否遵守 parallel_tool_calls 无关
 *   - 对 DeepSeek / 千问 / OpenAI 等任何支持 function calling 的模型都通用
 *
 * 运行：node src/multi-agent-serial-router.mjs（需在 .env 配置模型相关变量）
 */
import "dotenv/config";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  Annotation,
  END,
  START,
  StateGraph,
  messagesStateReducer,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";

import { lookupCityTrivia, lookupWeather } from "./simple-mock.mjs";

// 模型：从 .env 读取模型名、Key 与 BaseURL（兼容国内中转服务）
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// ---------- 子代理与工具（与 createSupervisor 版完全相同） ----------

const lookupWeatherTool = tool(
  async ({ city }) => lookupWeather(city),
  {
    name: "lookup_weather",
    description: "查询某城市当日天气概况（气温区间、天气、空气质量等）。",
    schema: z.object({
      city: z.string().describe("城市名，如 杭州"),
    }),
  }
);

const lookupCityTriviaTool = tool(
  async ({ city }) => lookupCityTrivia(city),
  {
    name: "lookup_city_trivia",
    description: "查询与某城市相关的一句趣味知识。",
    schema: z.object({
      city: z.string().describe("城市名，如 杭州"),
    }),
  }
);

const weatherAgent = createAgent({
  name: "weather_agent",
  description: "专门查天气",
  model,
  tools: [lookupWeatherTool],
  systemPrompt: "你只处理天气。用户提到城市时，用 lookup_weather 查询后再用中文简短说明。",
});

const triviaAgent = createAgent({
  name: "trivia_agent",
  description: "专门讲与城市相关的小知识；必须调用 lookup_city_trivia。",
  model,
  tools: [lookupCityTriviaTool],
  systemPrompt: "你只讲城市小知识。先 lookup_city_trivia，再用人话转述，不要编造工具里没有的内容。",
});

// ---------- 路由模型：结构化输出，天然一次只选一个 ----------
const routerModel = model.withStructuredOutput(
  z.object({
    next: z
      .enum(["weather_agent", "trivia_agent", "FINISH"])
      .describe("下一步交给哪个子代理；如果所有子任务都已完成则选 FINISH"),
    task: z
      .string()
      .describe("从用户需求中抽取、需要交给该子代理完成的具体子任务，一句话说清；FINISH 时填空串"),
  }),
  {
    name: "route",
    method: "functionCalling",
    description: "决定多智能体协作中下一步交给哪个子代理，或结束任务(FINISH)",
  }
);

// ---------- 图状态 ----------
const RouterState = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
  route: Annotation({
    // 每轮由 supervisor 重新决定，直接覆盖
    reducer: (a, b) => b ?? a,
    default: () => ({ next: "FINISH", task: "" }),
  }),
  usedAgents: Annotation({
    // 记录已被调用过的子代理，保证每个 agent 最多执行一次
    reducer: (a, b) => [...new Set([...(a ?? []), ...(b ?? [])])],
    default: () => [],
  }),
});

// ---------- 节点 ----------
const ROUTER_SYSTEM = new SystemMessage(
  `你是多智能体调度员。规则：
1. 用户消息里可能包含多个子任务，你每次只能挑【一个】尚未完成的子任务作为 task。
   task 只能描述这一件事，严禁把多个子任务合并写进同一条 task。
2. 子代理的结果已在对话中出现过时，视为该子任务已完成，不要重复派。
3. 所有子任务都已完成，或没有合适子代理可派时，输出 FINISH。`
);

const supervisorNode = async (state) => {
  const route = await routerModel.invoke([
    ROUTER_SYSTEM,
    ...state.messages,
  ]);
  // 兜底：路由到已执行过的子代理，说明没有新进展，强制结束并汇总，
  // 避免个别模型不返回 FINISH 导致 GraphRecursionError / 重复执行。
  if (route.next !== "FINISH" && state.usedAgents.includes(route.next)) {
    const summary = await model.invoke(state.messages);
    return { route: { next: "FINISH", task: "" }, messages: [summary] };
  }
  if (route.next === "FINISH") {
    // 所有子代理都已执行完，汇总最终回答
    const summary = await model.invoke(state.messages);
    return { route, messages: [summary] };
  }
  return { route };
};

// 调用某个子代理。
// 只把「分配到的子任务」传给它（不传完整历史），避免子代理越权处理其他子任务，
// 也避免 supervisor 误判「某个子任务已被完成」而不再路由。
const callAgent = (agent, name) => async (state) => {
  const output = await agent.invoke({
    messages: [new HumanMessage(state.route.task)],
  });
  const last = output.messages.at(-1);
  return { messages: [last], usedAgents: [name] };
};

// ---------- 构图 ----------
const graph = new StateGraph(RouterState)
  .addNode("supervisor", supervisorNode)
  .addNode("weather_agent", callAgent(weatherAgent.graph, "weather_agent"))
  .addNode("trivia_agent", callAgent(triviaAgent.graph, "trivia_agent"))
  .addEdge(START, "supervisor")
  .addConditionalEdges(
    "supervisor",
    (state) => state.route.next,
    { weather_agent: "weather_agent", trivia_agent: "trivia_agent", FINISH: END }
  )
  .addEdge("weather_agent", "supervisor")
  .addEdge("trivia_agent", "supervisor")
  .compile();

const app = graph;

// 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
const drawable = await app.getGraphAsync();
console.log(drawable.drawMermaid({ withStyles: true }));

const input = {
  messages: [
    new HumanMessage("查一下杭州的天气，再讲一条和杭州有关的小知识。"),
  ],
};

const nodePath = [];
let finalState = null;
const stream = await app.stream(input, { streamMode: ["updates", "values"] });
for await (const event of stream) {
  const [mode, payload] = event;
  if (mode === "updates" && payload && typeof payload === "object") {
    nodePath.push(...Object.keys(payload));
  } else if (mode === "values") {
    finalState = payload;
  }
}

console.log("路径:", nodePath.join(" → "));
const last = finalState?.messages?.at(-1);
console.log(last?.content ?? finalState?.messages);
