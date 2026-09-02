/**
 * middleware-test.mjs —— LangChain 自定义 Middleware 实验①：日志 / 注入 / 短路
 *
 * 演示 createMiddleware 提供的三类生命周期钩子：
 *   - beforeAgent / afterAgent：Agent 开始前 / 结束后执行
 *   - beforeModel / afterModel：每次调用模型前 / 后执行（可统计调用次数）
 *   - wrapModelCall：完全包裹一次模型调用，可改写请求（如注入 system 上下文）
 *   - beforeModel.canJumpTo("end")：在模型调用前直接跳到指定节点，实现"短路结束"
 *
 * 三个自定义 middleware 依次叠加演示：
 *   1. LoggingMiddleware        —— 记录模型调用次数（通过 stateSchema 声明可写状态）
 *   2. AddContextMiddleware     —— 每次调用模型前追加"请用一句话简洁回答"的系统约束
 *   3. BlockedContentMiddleware —— 用户消息含 BLOCKED 关键词时拦截，不再调用模型
 *
 * 运行方式：
 *   node src/middleware-test.mjs
 *
 * 前置条件：.env 已配置模型相关环境变量
 */
import "dotenv/config"; // 加载 .env 到 process.env
import { z } from "zod"; // Zod：声明中间件可读写状态的 schema
import { ChatOpenAI } from "@langchain/openai"; // 对话模型（OpenAI 兼容协议）
import {
  createAgent,
  createMiddleware,
  HumanMessage,
  AIMessage,
} from "langchain"; // createAgent + createMiddleware 是本节主角

// --- 自定义 Middleware ---

/** 日志 + 模型调用次数统计：用 stateSchema 声明一个跨钩子共享的计数器字段 */
const loggingMiddleware = createMiddleware({
  name: "LoggingMiddleware",
  stateSchema: z.object({
    modelCallCount: z.number().default(0), // 累计模型调用次数，未设置时默认 0
  }),
  beforeAgent: (state) => {
    // Agent 启动钩子：打印当前收到的消息数
    console.log("\n[Logging] agent 开始，消息数:", state.messages.length);
  },
  beforeModel: (state) => {
    // 每次调用模型前打印：当前消息数 + 已调用次数（演示 beforeModel 频率）
    console.log(
      `[Logging] 即将调用模型，当前消息数: ${state.messages.length}，已调用: ${state.modelCallCount} 次`
    );
  },
  afterModel: (state) => {
    // 模型返回后：预览最后一条消息内容，并把计数器 +1 返回给状态（return 的对象会合并进 state）
    const last = state.messages.at(-1);
    const preview =
      typeof last?.content === "string"
        ? last.content.slice(0, 80)
        : JSON.stringify(last?.content)?.slice(0, 80);
    console.log(`[Logging] 模型返回: ${preview}...`);
    return { modelCallCount: state.modelCallCount + 1 };
  },
  afterAgent: (state) => {
    // Agent 收尾钩子：打印累计调用次数，直观展示 afterModel 的计数效果
    console.log(
      `[Logging] agent 结束，累计模型调用: ${state.modelCallCount} 次\n`
    );
  },
});

/** 在每次模型调用前追加 system 上下文：演示 wrapModelCall 改写请求再放行 */
const addContextMiddleware = createMiddleware({
  name: "AddContextMiddleware",
  wrapModelCall: async (request, handler) => {
    // request 是即将发出的模型请求；handler 是"继续原调用"的句柄
    console.log("[AddContext] 注入额外 system 上下文");
    return handler({
      ...request, // 保留原请求其余字段
      systemMessage: request.systemMessage.concat(
        "\n\n 请用一句话简洁回答。" // 在系统提示末尾追加简洁性约束
      ),
    });
  },
});

/** 拦截敏感词，直接结束 agent：演示 beforeModel 的 canJumpTo 短路能力 */
const blockedContentMiddleware = createMiddleware({
  name: "BlockedContentMiddleware",
  beforeModel: {
    canJumpTo: ["end"], // 声明本钩子允许直接跳到 end 节点
    hook: (state) => {
      // 取最新一条用户消息，检测是否含 BLOCKED 关键词
      const last = state.messages.at(-1);
      const text =
        typeof last?.content === "string" ? last.content : String(last?.content ?? "");
      if (text.includes("BLOCKED")) {
        console.log("[Blocked] 检测到 BLOCKED，短路结束");
        return {
          messages: [new AIMessage("该请求已被 middleware 拦截，无法处理。")], // 注入拦截答复
          jumpTo: "end", // 跳过模型调用，直接结束本轮
        };
      }
      // 未命中则不返回任何状态更新，钩子自然放行到模型调用
    },
  },
});

// --- Agent ---

// 模型实例
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  temperature: 0,
});

// 组装 Agent：按声明顺序叠加三个中间件（顺序影响钩子执行次序）
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: "你是一个助手。",
  middleware: [
    loggingMiddleware,
    addContextMiddleware,
    blockedContentMiddleware,
  ],
});

// 两条测试输入：正常问题 → 应看到完整日志链；含 BLOCKED → 应看到模型调用被跳过
for (const text of [
  "用中文说：middleware 是什么？",
  "这句话包含 BLOCKED 关键词",
]) {
  console.log("\n用户:", text);
  // invoke 返回值会带中间件声明的 state 字段（modelCallCount），可直接读取
  const { messages, modelCallCount } = await agent.invoke({
    messages: [new HumanMessage(text)],
  });
  console.log("回复:", messages.at(-1)?.content);
  console.log("modelCallCount:", modelCallCount);
}
