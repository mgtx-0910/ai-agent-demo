/**
 * createSupervisor 版 —— 不靠提示词，用 postModelHook 做机制级约束
 *
 * 说明：
 * - createSupervisor 源码里对 ChatOpenAI 类模型【已经】自动 bindTools(..., { parallel_tool_calls: false })，
 *   即库本身设计就是「一次只派一个子代理」（串行 handoff），不是靠提示词。
 * - 但 DeepSeek 等 OpenAI 兼容接口会忽略 parallel_tool_calls:false，仍可能一次返回多个 handoff tool_call；
 *   而 LangGraph 对子图返回的多个 PARENT Command 只处理第一个，会丢消息 → 400。
 * - 这里的 postModelHook 在模型输出后【机制层】强制只保留第一个 tool_call，彻底规避该问题，
 *   因此提示词里完全不需要“一次只能派一个”这种约束。
 *
 * 运行：node src/multi-agent-supervisor-posthook.mjs（需在 .env 配置模型相关变量）
 */
import "dotenv/config";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";

import { lookupCityTrivia, lookupWeather } from "./simple-mock.mjs";

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// 验证 1：createSupervisor 内部对 ChatOpenAI 做了什么
// （模拟源码逻辑：isChatModelWithBindTools && isChatModelWithParallelToolCallsParam && name in PROVIDERS）
console.log("model._modelType():", model._modelType?.());
console.log("model.bindTools.length:", model.bindTools.length);
console.log("model.getName():", model.getName());
const simulatedBound = model.bindTools([], { parallel_tool_calls: false });
console.log("bindTools kwargs:", JSON.stringify(simulatedBound.kwargs ?? null));

const lookupWeatherTool = tool(
  async ({ city }) => lookupWeather(city),
  {
    name: "lookup_weather",
    description: "查询某城市当日天气概况（气温区间、天气、空气质量等）。",
    schema: z.object({ city: z.string().describe("城市名，如 杭州") }),
  }
);

const lookupCityTriviaTool = tool(
  async ({ city }) => lookupCityTrivia(city),
  {
    name: "lookup_city_trivia",
    description: "查询与某城市相关的一句趣味知识。",
    schema: z.object({ city: z.string().describe("城市名，如 杭州") }),
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

const workflow = createSupervisor({
  agents: [weatherAgent.graph, triviaAgent.graph],
  llm: model,
  // 注意：prompt 里【没有】“一次只能派一个 agent”之类的约束
  prompt: `你是调度员，只负责选人，不要自己报气温、也不要自己讲城市百科。
- 问天气、气温、下不下雨、空气 → 用 weather_agent
- 问小知识、名胜、历史、一句介绍 → 用 trivia_agent`,
  // 机制级兜底：模型一次返回多个 tool_call 时，强制只保留第一个。
  // 这样 ToolNode 每次只会拿到一个 handoff Command，不会触发
  // “多个 PARENT Command 只处理第一个 → 丢 ToolMessage → 400” 的坑。
  postModelHook: async (state) => {
    const last = state.messages.at(-1);
    if (last && Array.isArray(last.tool_calls) && last.tool_calls.length > 1) {
      const [first] = last.tool_calls;
      console.log(`  [postModelHook] 截断 ${last.tool_calls.length} 个 tool_call → 只保留 ${first.name}`);
      const trimmed = new AIMessage({
        id: last.id,
        content: last.content,
        tool_calls: [first],
        name: last.name,
        response_metadata: last.response_metadata,
      });
      return { messages: [trimmed] };
    }
    return {};
  },
});

const app = workflow.compile();

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
