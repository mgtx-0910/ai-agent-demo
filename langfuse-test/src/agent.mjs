/**
 * agent.mjs —— 被测 Agent 的「工厂」：两个工具 + DeepAgent，demo 与 eval 共用
 *
 * 为什么单独抽一个文件：index.mjs（单次调用看 trace）和 evaluate.mjs（批量评测）必须跑
 * 同一个 Agent，否则评测结果不能代表线上行为。Agent 定义只写一处，两边 import 同一个工厂函数。
 *
 * 注意本文件里没有任何 Langfuse 代码 —— 观测（CallbackHandler）与评测（Dataset）都由调用方注入，
 * 这样 Agent 本身与观测厂商解耦，换成 LangSmith 等其他平台也不用改这个文件。
 */
import { tool } from "langchain";
import { z } from "zod";
import { createDeepAgent } from "deepagents";

// ---------------------------------------------------------------------------
// 工具 1：get_weather —— 演示「有外部数据源」的工具
// ---------------------------------------------------------------------------
/**
 * tool(实现函数, 配置) 是 LangChain 定义工具的标准写法，三个要素缺一不可：
 *   1. 实现函数：真正执行的逻辑，可以是 async
 *   2. name + description：模型「读描述选工具」的依据，description 写得越清楚越不容易选错工具
 *   3. schema：用 zod 声明参数类型，会被转成 JSON Schema 随工具定义一起发给模型，
 *      模型据此生成参数；describe() 写的是「这个参数怎么填」的提示
 * 返回值为字符串（会被包装成 ToolMessage 回填给模型继续推理）。
 *
 * 这里刻意用「模拟数据」：目的是让 demo 稳定可复现，不引入外部依赖和网络不确定性；
 * 也正因为返回值固定，evaluate.mjs 才能用确定性关键词断言（如「上海」「31」）来打分。
 */
const getWeather = tool(
  async ({ city }) => {
    const data = {
      shanghai: "31°C，闷热多云",
      tokyo: "28°C，晴",
      beijing: "33°C，晴热",
    };
    // 大小写/空格归一化，命中返回描述，未命中返回一句「查不到」——
    // 让模型能区分「工具成功但无数据」与「工具失败」，避免它自己编天气
    return data[city.trim().toLowerCase()] ?? `暂无 ${city} 的天气数据`;
  },
  {
    name: "get_weather",
    description: "查询城市天气（模拟数据）",
    schema: z.object({
      city: z.string().describe("城市英文名，如 Shanghai"),
    }),
  },
);

// ---------------------------------------------------------------------------
// 工具 2：calculate —— 演示「参数是数字」的工具
// ---------------------------------------------------------------------------
/**
 * 注意 a + b 是数值相加（不是字符串拼接）。
 * 返回值用 String() 转成字符串：工具结果最终要写进消息内容，统一成字符串最省事，
 * 也让「模型把两地问温度相加」这件事必然由工具完成，而不是靠模型心算 —— 这正是评测能断言 59 的前提。
 */
const calculate = tool(
  async ({ a, b }) => String(a + b),
  {
    name: "calculate",
    description: "两个数相加",
    schema: z.object({
      a: z.number(),
      b: z.number(),
    }),
  },
);

/**
 * 创建 Agent 实例（每次调用返回新实例，实例之间不共享对话状态，因此评测可并行/重复运行）。
 *
 * createDeepAgent 来自 deepagents 包：它在 LangChain 原生 createAgent 之上预置了
 * 「任务规划 + 工具调用循环」等能力；这里只用最朴素的形态（模型 + 工具 + 系统提示），
 * 便于把注意力放在 trace 与评测上。
 *
 *   - model：字符串 "openai:<模型名>" 是 deepagents/langchain 的通用写法，
 *     走 OpenAI 兼容协议 —— 配合 .env 里的 OPENAI_BASE_URL 就能指向阿里百炼等网关
 *   - tools：传工具数组，模型在这些工具里自主选择、可多次调用
 *   - systemPrompt：只说两件事 —— 「什么任务用哪个工具」+「用简体中文回答」。
 *     中文约束很重要：它保证回复里出现的是「上海/东京」等中文词，
 *     与 evaluate.mjs 的期望关键词一致，评测才不会因语言漂移而误判失败
 */
export function createAgent() {
  return createDeepAgent({
    model: `openai:${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
    tools: [getWeather, calculate],
    systemPrompt: "你是助手。查天气用 get_weather，加法用 calculate。用简体中文回答。",
  });
}

/**
 * 从 agent 结果里取出最终回复文本。
 *
 * invoke 返回的是图状态对象，其中 messages 是完整对话数组，最后一条即 AI 的最终回复。
 * content 有两种形态，都要兼容：
 *   - string：最常见
 *   - 数组：多模态或部分 provider 会把内容拆成 [{ type: "text", text: "..." }, ...]
 * 最后用 String(...) 兜底，确保调用方拿到的永远是字符串 ——
 * 否则 evaluator 里的 .toLowerCase() / .trim() 会直接抛错。
 */
export function extractReply(result) {
  const last = result?.messages?.at(-1);
  if (typeof last?.content === "string") return last.content;
  if (Array.isArray(last?.content)) {
    return last.content
      .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
      .join("");
  }
  return String(last?.content ?? result ?? "");
}
