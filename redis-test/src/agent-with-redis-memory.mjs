/**
 * 基于 Redis 的 Agent 短期记忆
 *
 * 模式：
 * - invoke 前：从 Redis 读取该会话的 messages
 * - invoke 后：把 agent 返回的 messages 写回 Redis（带 TTL）
 * - 压缩：由 langchain summarizationMiddleware 在 agent 内部完成
 *
 * 前置：docker compose up -d redis
 *
 * 运行：node src/agent-with-redis-memory.mjs
 * 输入 exit / quit / :q 退出；:clear 清空当前会话记忆
 */
import "dotenv/config";
import Redis from "ioredis";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ChatOpenAI } from "@langchain/openai";
// 记忆序列化协议：ChatMessage 类实例（HumanMessage/AIMessage...）无法直接
// JSON.stringify 落库，需先经 mapChatMessagesToStoredMessages 摊平成纯 JSON
// （StoredMessage：{ type: "human"|"ai"|"system", data: { content, ... } }）；
// 读回时再由 mapStoredMessagesToChatMessages 按 type 重建对应消息实例，
// 两个函数成对使用，保证 Redis 里存的是可跨进程/跨语言读取的可移植结构。
import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages";
import { createAgent, HumanMessage, summarizationMiddleware } from "langchain";

// ----------------------------------------------------------------------------
// 环境变量读取（全部带默认值，便于直接体验）
// ----------------------------------------------------------------------------
const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const REDIS_DB = Number(process.env.REDIS_DB ?? 0);
const MEMORY_TTL = Number(process.env.MEMORY_TTL_SECONDS ?? 1800); // 记忆过期秒数
const KEY_PREFIX = process.env.MEMORY_KEY_PREFIX ?? "agent:short_memory"; // Redis key 前缀
const SESSION_ID = process.env.MEMORY_SESSION_ID ?? "demo_user_001"; // 会话标识（可多开模拟多用户）

// ----------------------------------------------------------------------------
// 对话压缩提示词：消息累积过多时，由 summarizationMiddleware 调用 LLM 生成摘要。
// 模板中的 {messages} 由中间件自动替换为「待压缩的历史消息」；生成的摘要文字
// 会以一条 HumanMessage 的形式放回对话历史，作为后续轮次的上下文。
// ----------------------------------------------------------------------------
const summaryPrompt = `你是对话摘要助手。请用中文总结以下对话，包含：
1. 讨论的主要话题
2. 用户提到的重要事实（姓名、偏好、日期等，务必保留原文信息）
3. 继续对话所需的关键上下文

保持简洁，不要编造，不要遗漏用户明确说过的信息。

待摘要的对话：
{messages}

摘要：`;

// ----------------------------------------------------------------------------
// RedisMessageStore：把「会话消息」序列化为 JSON 存入 Redis，带 TTL 自动过期。
// 存储格式使用 langchain 的 StoredMessage（可移植结构），而非裸字符串。
// ----------------------------------------------------------------------------
class RedisMessageStore {
  constructor({ redis, keyPrefix, ttlSeconds }) {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
    this.ttlSeconds = ttlSeconds;
  }

  // 生成该会话的记忆 key，最终形如：agent:short_memory:<sessionId>:messages
  messagesKey(sessionId) {
    return `${this.keyPrefix}:${sessionId}:messages`;
  }

  // 读取并反序列化历史消息；无记录时返回空数组。
  // JSON.parse 拿到的是 StoredMessage 纯数据，mapStoredMessagesToChatMessages
  // 会按每条的 type 字段重建为 HumanMessage / AIMessage / SystemMessage 等
  // 类型化实例，供 agent 直接作为对话历史使用。
  async loadMessages(sessionId) {
    const raw = await this.redis.get(this.messagesKey(sessionId));
    if (!raw) return [];
    return mapStoredMessagesToChatMessages(JSON.parse(raw));
  }

  // 序列化并写回消息，同时刷新 TTL（每轮对话都会续期）。
  // mapChatMessagesToStoredMessages 等价于对每条消息调 toDict()，把类实例
  // 摊平成可持久化的纯 JSON（StoredMessage），再 JSON.stringify 存入 Redis。
  async saveMessages(sessionId, messages) {
    const payload = JSON.stringify(mapChatMessagesToStoredMessages(messages));
    await this.redis.set(this.messagesKey(sessionId), payload, "EX", this.ttlSeconds);
  }

  // 清空该会话记忆（:clear 命令触发）
  async clear(sessionId) {
    await this.redis.del(this.messagesKey(sessionId));
  }

  // 查询该会话记忆剩余存活秒数（用于展示）
  async ttl(sessionId) {
    return this.redis.ttl(this.messagesKey(sessionId));
  }
}

/**
 * 执行一次「带记忆」的对话：
 * 1) 从 Redis 加载历史消息；
 * 2) 历史 + 用户新消息 一起交给 agent（历史过多时中间件会先压缩成摘要）；
 * 3) 把 agent 返回的完整消息列表存回 Redis。
 */
async function invokeWithMemory(agent, store, sessionId, userText) {
  const history = await store.loadMessages(sessionId);
  console.log(`  ↳ 从 Redis 加载 ${history.length} 条历史`);

  const result = await agent.invoke(
    { messages: [...history, new HumanMessage(userText)] },
    { recursionLimit: 30 },
  );

  await store.saveMessages(sessionId, result.messages);
  const ttl = await store.ttl(sessionId);
  console.log(`  ↳ 写回 Redis ${result.messages.length} 条 (TTL ${ttl}s)`);

  return result;
}

// Redis 客户端（连接参数来自环境变量）
const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB });

redis.on("connect", () => console.log("✅ Redis 已连接"));
redis.on("error", (err) => console.error("❌ Redis 错误:", err.message));

// 全局复用同一个记忆存储（固定 SESSION_ID，续跑时可继续上一轮记忆）
const store = new RedisMessageStore({
  redis,
  keyPrefix: KEY_PREFIX,
  ttlSeconds: MEMORY_TTL,
});

// 对话模型（OpenAI 兼容接口，temperature=0 保证输出稳定）
const model = new ChatOpenAI({
  model: process.env.OPENAI_MODEL,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
});

// 无工具 Agent + 摘要中间件。压缩动作本身由 langchain 的 summarizationMiddleware
// 在每次 agent.invoke() 前自动执行，本文件没有任何自写的压缩逻辑；摘要文字由
// 下方同一个 model（ChatOpenAI）按 summaryPrompt 调用生成（见依赖源码
// node_modules/langchain/dist/agents/middleware/summarization.js）。
//   trigger.messages = 8 → 消息达到 8 条时触发压缩
//   keep.messages    = 4 → 压缩后仅保留最近 4 条，更早消息被合成 1 条摘要
//                           （langchain 内部以 HumanMessage 插回，并带
//                            lc_source="summarization" 标记，随后被 agent 照常读入）
//
//   ※ 触发计数细节（读自 langchain 源码 summarization.js）：trigger.messages 数的
//     是 state.messages 的总条数（messages.length），不区分 Human/AI/System/Tool——
//     注入的记忆 SystemMessage、agent 系统提示（若前置为首条）都各占 1 条，
//     也不管是否同属一轮。每轮对话约 +2 条，所以 8 条大致相当于 3~4 轮。
//   ※ keep 的保留对象：先拆掉首条 SystemMessage（系统提示）再对真实对话截断，
//     保留最近 4 条（会自动安全对齐，不拆散 AI 工具调用与其 ToolMessage）。
//   ※ 多个 trigger 之间是 OR；单个 trigger 内同时写 messages/tokens/fraction 时是
//     AND。本项目只配 messages，即"总量到 8 就压、不分谁发的"。
const agent = createAgent({
  model,
  tools: [],
  systemPrompt:
    "你是会话助手。记住用户提到的关键事实，中文简短回答。若消息中有对话摘要，请据此继续对话。",
  middleware: [
    summarizationMiddleware({
      model,
      summaryPrompt,
      trigger: { messages: 8 },
      keep: { messages: 4 },
    }),
  ],
});

console.log("输入 exit / quit / :q 退出，:clear 清空记忆\n");

// 命令行交互（readline/promises）
const rl = readline.createInterface({ input: stdin, output: stdout });

// 当前会话已有的历史条数：用于判断本轮是否发生了摘要压缩
// （若返回消息数未按 历史 + 用户 + 助手 的规律增长，说明已触发压缩）
let prevCount = (await store.loadMessages(SESSION_ID)).length;

try {
  while (true) {
    const userText = (await rl.question("你: ")).trim();
    if (!userText) continue;

    // 退出指令
    if (["exit", "quit", ":q"].includes(userText.toLowerCase())) break;

    // 清空当前会话记忆
    if (userText === ":clear") {
      await store.clear(SESSION_ID);
      prevCount = 0;
      console.log("已清空当前会话记忆\n");
      continue;
    }

    // 常规对话：带记忆 invoke
    const { messages } = await invokeWithMemory(agent, store, SESSION_ID, userText);
    console.log("\n助手:", messages.at(-1)?.content);
    console.log(`当前消息数: ${messages.length}`);
    // 消息数增长少于预期 => 中间件已把早期消息压缩成摘要
    if (messages.length < prevCount + 2) {
      console.log("  ⚡ 已触发压缩");
    }
    prevCount = messages.length;
    console.log();
  }
} finally {
  rl.close();
}

await redis.quit();
