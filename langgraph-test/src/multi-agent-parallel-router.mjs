/**
 * 多智能体 Supervisor（主管-下属）模式演示 —— 并行路由版
 *
 * 与串行版（multi-agent-serial-router.mjs）的区别：
 *   - 用 LangGraph 的 Send 动态扇出，一次拆出所有子任务并【并行】执行，
 *     不互相等待；所有子代理完成后统一汇总。
 *   - 完全不依赖 createSupervisor / parallel_tool_calls，与模型无关。
 *
 * 流程：
 *   dispatcher（拆任务）--Send--> weather_agent ─┐
 *                              └--> trivia_agent ─┼--> aggregator（汇总）--> END
 *
 * 运行：node src/multi-agent-parallel-router.mjs（需在 .env 配置模型相关变量）
 */
import "dotenv/config";

import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  Annotation,
  END,
  Send,
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

// ---------- 子代理与工具 ----------

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

// ---------- 任务规划模型：一次拆出所有可并行的子任务 ----------

const plannerModel = model.withStructuredOutput(
  z.object({
    tasks: z
      .array(
        z.object({
          agent: z
            .enum(["weather_agent", "trivia_agent"])
            .describe("处理该子任务最合适的子代理"),
          task: z
            .string()
            .describe("该子代理需要完成的具体子任务，一句话说清，只包含这一件事"),
        })
      )
      .describe("需要并行执行的子任务列表；用户需求中没有可分配给子代理的任务时给空数组"),
  }),
  {
    name: "plan",
    method: "functionCalling",
    description: "把用户请求拆解为互不依赖、可并行执行的子任务列表",
  }
);

const PLANNER_SYSTEM = new SystemMessage(
  `你是多智能体任务规划员。
1. 把用户请求拆解为互不依赖的原子子任务，每个子任务分配一个最合适的子代理。
2. 每个子任务必须是独立的一件事，严禁把多个子任务合并写进同一条 task。
3. 无法分配给任何子代理的内容不必列出。`
);

// ---------- 图状态 ----------

const ParallelState = Annotation.Root({
  messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
  plan: Annotation({
    // 由 dispatcher 覆盖
    reducer: (a, b) => b ?? a,
    default: () => ({ tasks: [] }),
  }),
  results: Annotation({
    // 各并行分支的结果追加合并
    reducer: (a, b) => [...(a ?? []), ...(b ?? [])],
    default: () => [],
  }),
});

// ---------- 节点 ----------

// dispatcher：调用 planner 拆任务，把结果写入 state（路由由条件边决定）
const dispatcherNode = async (state) => {
  const plan = await plannerModel.invoke([PLANNER_SYSTEM, ...state.messages]);
  return { plan };
};

// 条件边：根据 plan 动态扇出并行分支（Send），没有任务则直接去汇总
const dispatchRoute = (state) => {
  const tasks = state.plan?.tasks ?? [];
  if (tasks.length === 0) return "aggregator";
  // 每个 Send 携带该分支自己的输入状态：{ task }
  return tasks.map((t) => new Send(t.agent, { task: t.task }));
};

// 并行分支节点：每个子代理只处理自己收到的 task，结果写入 results
const makeAgentNode = (agent, name) => async (state) => {
  const t0 = Date.now();
  console.log(`  [${name}] 开始（相对 ${t0 - tStart}ms）`);
  const output = await agent.invoke({
    messages: [new HumanMessage(state.task)],
  });
  const last = output.messages.at(-1);
  const content =
    typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
  console.log(`  [${name}] 完成（耗时 ${Date.now() - t0}ms，相对 ${Date.now() - tStart}ms）`);
  return { results: [{ agent: name, content }] };
};

// aggregator：合并各分支结果，生成最终回答
const aggregatorNode = async (state) => {
  if (state.results.length === 0) {
    // 没有可分的子任务，直接由主模型回答
    const answer = await model.invoke(state.messages);
    return { messages: [answer] };
  }
  const resultsText = state.results
    .map((r) => `【${r.agent}】\n${r.content}`)
    .join("\n\n");
  const answer = await model.invoke([
    ...state.messages,
    new HumanMessage(
      `以下是各子代理并行完成的结果，请整合成一份连贯、面向用户的最终回答：\n\n${resultsText}`
    ),
  ]);
  return { messages: [answer] };
};

// ---------- 构图 ----------

const graph = new StateGraph(ParallelState)
  .addNode("dispatcher", dispatcherNode)
  .addNode("weather_agent", makeAgentNode(weatherAgent.graph, "weather_agent"))
  .addNode("trivia_agent", makeAgentNode(triviaAgent.graph, "trivia_agent"))
  .addNode("aggregator", aggregatorNode)
  .addEdge(START, "dispatcher")
  .addConditionalEdges(
    "dispatcher",
    dispatchRoute,
    { weather_agent: "weather_agent", trivia_agent: "trivia_agent", aggregator: "aggregator" }
  )
  .addEdge("weather_agent", "aggregator")
  .addEdge("trivia_agent", "aggregator")
  .addEdge("aggregator", END)
  .compile();

const app = graph;

// 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
const drawable = await app.getGraphAsync();
console.log(drawable.drawMermaid({ withStyles: true }));

const tStart = Date.now();
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
console.log("总耗时:", `${Date.now() - tStart}ms`);

const last = finalState?.messages?.at(-1);
console.log(last?.content ?? finalState?.messages);
