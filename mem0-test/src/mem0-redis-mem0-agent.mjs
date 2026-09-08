/**
 * 分层记忆 Agent 演示：Redis 记「这轮聊天」，Mem0 记「值得长期留着的事」。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  记忆分层思想                                                        │
 * │  用户层（user，跨会话长期）  = 换天聊还认得你                          │
 * │     例：姓名 / 居住地 / 饮食禁忌 / 长期爱好 —— 存 Mem0（user_id 维度）  │
 * │  会话层（session，仅当前会话）= 只管当前这个聊天窗口                    │
 * │     例：正在做的任务 / 大纲 / 进度 / 待办 —— 存 Mem0（run_id 维度）     │
 * │  短期消息（最近几轮原文）    = Redis 完整对话消息，TTL 自动过期          │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 一轮对话完整流水：
 *   1) Redis 读最近几轮消息原文 → 拼进 invoke 上下文（保证"上一句说啥"接得住）；
 *   2) Mem0 并行检索 user 层 + session 层记忆 → 组装成 SystemMessage 注入；
 *   3) agent 回答（消息 ≥8 条时 summarizationMiddleware 自动把旧消息压成摘要）；
 *   4) 结果写回 Redis（剔除注入的 SystemMessage，刷新 TTL）；
 *   5) 用一个结构化分类器判断本轮是否有新事实、该写哪一层 → 写 Mem0。
 *
 * 前置：docker compose up -d redis；.env 配好 OPENAI_API_KEY / OPENAI_MODEL / MEM0_API_KEY
 * 运行：node src/mem0-redis-mem0-agent.mjs
 * 交互：:clear 清 Redis | :clear-mem0 清 Mem0 | exit / quit / :q 退出
 */
import "dotenv/config"; // 启动即加载项目根 .env（必须先于读取 env 的代码）
import Redis from "ioredis"; // Redis 客户端（存短期消息）
import * as readline from "node:readline/promises"; // 命令行交互输入
import { stdin, stdout } from "node:process"; // 标准输入/输出流
import { z } from "zod"; // 结构化输出 schema（定义分类器返回结构）
import { MemoryClient } from "mem0ai"; // Mem0 云端 SDK（user/session 双层长期记忆）
import { ChatOpenAI } from "@langchain/openai"; // OpenAI 兼容对话模型
import {
  SystemMessage,
  SystemMessageChunk,
  HumanMessage,
  mapChatMessagesToStoredMessages, // ChatMessage 实例 → 纯 JSON（落库前序列化）
  mapStoredMessagesToChatMessages, // 纯 JSON → ChatMessage 实例（读取后还原）
} from "@langchain/core/messages";
import { createAgent, summarizationMiddleware } from "langchain"; // Agent 框架 + 摘要压缩中间件

// ============================================================================
// 环境变量读取（全部带默认值，便于直接体验）
// ============================================================================

// --- Redis 连接（对应 redis-test/docker-compose 起的 agent_redis:6379）---
const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const REDIS_DB = Number(process.env.REDIS_DB ?? 0);
// 短期记忆过期秒数：超过该时长未对话，Redis 里的消息自动删除
const MEMORY_TTL = Number(process.env.MEMORY_TTL_SECONDS ?? 1800); // 默认 1800s = 30 分钟
// Redis key 前缀：最终形如 agent:short_memory:<sessionId>:messages
const KEY_PREFIX = process.env.MEMORY_KEY_PREFIX ?? "agent:short_memory";

// --- Mem0 维度标识 ---
// 用户层：凡是 user_id 维度写入的记忆，换任何会话都能检索到
const USER_ID = process.env.MEM0_USER_ID ?? "demo_user_001";
// 会话层 run_id：与 MEMORY_SESSION_ID 解耦，这里固定写死 session_002，
// 保证每次重启仍命中同一个「会话层」记忆桶（想开新会话改这个常量即可）
const SESSION_ID = "session_002";
// 语义检索时每个维度返回的最多记忆条数
const MEM0_TOP_K = Number(process.env.MEM0_TOP_K ?? 5);

// 调试开关：DEBUG_SUMMARIZE=1 时，每次触发压缩会打印「被压缩的消息 + 摘要原文」
const DEBUG_SUMMARIZE = process.env.DEBUG_SUMMARIZE === "1";

// ============================================================================
// memorySchema：分类器必须输出的结构化字段（由 zod 描述，LLM 按此约束返回）
// ============================================================================
const memorySchema = z.object({
  // 是否需要写入「用户层」（跨会话长期）
  write_user: z
    .boolean()
    .describe(
      "写入用户层：换一个新会话仍应保留的长期事实（身份、居住地、长期爱好、饮食禁忌、持久偏好）。不含仅本轮任务。",
    ),
  // 是否需要写入「会话层」（仅当前会话）
  write_session: z
    .boolean()
    .describe(
      "写入会话层：仅当前会话/thread 有效的任务、大纲、进度、待办、临时决策（如「这次先写…」「数据部分明天补」）。",
    ),
  // 一句话说明分类理由（便于观察与调试）
  reason: z.string().describe("分类理由，一句话"),
});

// ============================================================================
// CLASSIFIER_PROMPT：记忆分层分类器的主提示词
// 它指导模型判断「本轮对话有没有值得记的新事实」以及「该归到哪一层」。
// ============================================================================
const CLASSIFIER_PROMPT = `你是记忆分层分类器。判断本轮对话是否有「新事实」需写入 Mem0，并分到正确层级。

## user 层（跨会话长期）
- 用户身份与画像：姓名、职业、居住地、长期爱好
- 长期偏好与约束：饮食过敏、回答风格、常用技术栈
- 持续数周以上的个人背景（非单次任务）

## session 层（仅当前会话）
- 当前正在做的任务、目标、文档大纲、方案草稿
- 本会话内的进度、决策、待办、临时约定
- 用户明确用「这次」「本轮」「当前会话」描述的工作上下文

## 均不写入
- 寒暄、致谢、纯确认
- 助手生成的通用内容（攻略、示例代码、建议清单），用户未明确采纳为新事实
- 无信息增量的复述

## 决策原则
1. 「这次我们先写 Q1 总结」「当前在排查 XX」→ 优先 session，不要标成 user
2. user 与 session 可同时为 true（如同时说职业+当前任务），但勿把纯会话任务只标 user
3. 一次性请求（如「帮我做旅行攻略」）且未产生需跨轮记住的约定 → 均为 false`;

// ============================================================================
// summaryPrompt：对话摘要提示词（配合 summarizationMiddleware 使用）
// 当 Redis 里的短期消息太多时，中间件会把早期消息压缩成一条摘要塞回上下文。
// {messages} 由中间件自动替换为「待压缩的对话」。
// ============================================================================
const summaryPrompt = `你是对话摘要助手。用中文简洁总结：话题、会话内进度/报错/待办。
用户级长期偏好由外部记忆维护，摘要勿重复堆砌。不要编造。

待摘要的对话：
{messages}

摘要：`;

/**
 * 过滤掉注入的 SystemMessage，得到「适合存回 Redis」的对话消息列表。
 *
 * 为什么需要：Mem0 检索到的记忆每轮都会以 SystemMessage 形式临时拼进
 * invoke 上下文，它们不是真正的对话轮次；若一并写回 Redis，下次读取时会
 * 与重新注入的新记忆重复堆叠，既浪费 token 又让记忆越来越脏。因此只保留
 * Human/AI 等真实对话消息（SystemMessage / SystemMessageChunk 一律剔除）。
 */
function messagesForRedis(messages) {
  return messages.filter(
    (m) => !SystemMessage.isInstance(m) && !SystemMessageChunk.isInstance(m),
  );
}

/**
 * RedisMessageStore：短期记忆（最近几轮对话原文）的存取层。
 *
 * 存储格式 = langchain 的 StoredMessage（序列化后的纯 JSON），
 * 可跨进程 / 跨语言读取；配合 TTL 实现「30 分钟没聊就自动遗忘」。
 */
class RedisMessageStore {
  constructor({ redis, keyPrefix, ttlSeconds }) {
    this.redis = redis; // ioredis 客户端
    this.keyPrefix = keyPrefix; // key 前缀
    this.ttlSeconds = ttlSeconds; // 过期秒数
  }

  // 组装本会话的 Redis key：<前缀>:<会话ID>:messages
  messagesKey(sessionId) {
    return `${this.keyPrefix}:${sessionId}:messages`;
  }

  /**
   * 读取并反序列化历史消息；无记录时返回空数组。
   * JSON.parse 得到 StoredMessage 纯数据，再按 type 还原为
   * HumanMessage / AIMessage 等实例，供 agent 当对话历史用。
   */
  async loadMessages(sessionId) {
    const raw = await this.redis.get(this.messagesKey(sessionId));
    if (!raw) return [];
    return mapStoredMessagesToChatMessages(JSON.parse(raw));
  }

  /**
   * 序列化并写回消息，同时刷新 TTL（每轮对话都会续期）。
   * mapChatMessagesToStoredMessages ≈ 对每条消息调 toDict()，摊平成纯 JSON。
   */
  async saveMessages(sessionId, messages) {
    const payload = JSON.stringify(mapChatMessagesToStoredMessages(messages));
    await this.redis.set(this.messagesKey(sessionId), payload, "EX", this.ttlSeconds);
  }

  // 清空该会话短期记忆（:clear 命令触发）
  async clear(sessionId) {
    await this.redis.del(this.messagesKey(sessionId));
  }

  // 查询剩余存活秒数（仅用于界面展示）
  async ttl(sessionId) {
    return this.redis.ttl(this.messagesKey(sessionId));
  }
}

/**
 * Mem0MemoryStore：长期记忆（user 层 + session 层）的检索与写入封装。
 *
 * 依赖一个「分类器」模型：每轮回答完后，判断是否有新事实、写哪一层。
 */
class Mem0MemoryStore {
  constructor({ client, userId, sessionId, topK, classifier }) {
    this.client = client; // mem0ai MemoryClient（云端）
    this.userId = userId; // user 层维度
    this.sessionId = sessionId; // session 层维度（即 run_id）
    this.topK = topK; // 每层最多取回条数
    this.classifier = classifier; // 结构化输出的分类模型（判断写哪层）
  }

  /**
   * 语义检索：按 query 同时查 user 层与 session 层。
   * - user 层：filters 只用 user_id（该用户所有会话共享的长期事实）
   * - session 层：filters 用 AND 组合 user_id + run_id（只命中当前会话内的事）
   * 两层并行查询（Promise.all），任一查询异常都会整体 reject。
   */
  async search(query) {
    const [userRes, sessionRes] = await Promise.all([
      // 查「用户长期记忆」
      this.client.search(query, {
        filters: { user_id: this.userId },
        topK: this.topK,
      }),
      // 查「当前会话记忆」
      this.client.search(query, {
        filters: {
          AND: [{ user_id: this.userId }, { run_id: this.sessionId }],
        },
        topK: this.topK,
      }),
    ]);
    return {
      user: userRes.results ?? [],
      session: sessionRes.results ?? [],
    };
  }

  /**
   * 把检索到的记忆拼成一条 SystemMessage 注入对话。
   * 记忆为空时返回 null（调用方就不注入，避免塞空 SystemMessage 占 token）。
   * 提示词末尾带「请结合以上记忆回答，勿编造」约束模型不可瞎编记忆之外的事。
   */
  buildSystemMessage({ user, session }) {
    const blocks = [];
    if (user.length) {
      blocks.push(`【用户长期记忆】\n${user.map((m) => `- ${m.memory}`).join("\n")}`);
    }
    if (session.length) {
      blocks.push(`【当前会话记忆】\n${session.map((m) => `- ${m.memory}`).join("\n")}`);
    }
    if (!blocks.length) return null;
    return new SystemMessage(`${blocks.join("\n\n")}\n\n请结合以上记忆回答，勿编造。`);
  }

  /**
   * 分类并持久化：把「用户本轮说的话 + 助手本轮的回答」交给分类器，
   * 按结构化结果决定是否写入 Mem0（以及写 user / session 哪一层）。
   *
   * - turn 是原始对话轮次（不经过摘要），Mem0 会自己做抽取；
   * - classifier 用 withStructuredOutput(memorySchema) 保证返回合法 JSON；
   * - 返回值 written: 实际写入的层数组，reason: 分类理由（用于观察）。
   */
  async classifyAndPersist(userText, assistantText) {
    const turn = [
      { role: "user", content: userText },
      { role: "assistant", content: assistantText },
    ];

    // 用分类模型走结构化输出，一次调用拿回 { write_user, write_session, reason }
    const { write_user, write_session, reason } = await this.classifier.invoke([
      new SystemMessage(CLASSIFIER_PROMPT),
      new HumanMessage(`用户：${userText}\n助手：${assistantText}`),
    ]);

    const written = [];
    // 该写 user 层 → 只带 userId 写入（跨会话可见）
    if (write_user) {
      await this.client.add(turn, { userId: this.userId });
      written.push("user");
    }
    // 该写 session 层 → 带 userId + runId 写入（仅当前会话可见）
    if (write_session) {
      await this.client.add(turn, { userId: this.userId, runId: this.sessionId });
      written.push("session");
    }
    return { written, reason };
  }

  /**
   * 清空当前用户的 user 层 + 当前 session 层记忆（:clear-mem0 触发）。
   * 分两次 deleteAll：第一次删 user 维度，第二次删 user+run 维度的会话记忆。
   */
  async clear() {
    await this.client.deleteAll({ userId: this.userId });
    await this.client.deleteAll({ userId: this.userId, runId: this.sessionId });
  }
}

/**
 * 执行一次「分层记忆」对话：
 * 1) Redis 读历史 → 2) Mem0 查两层记忆 → 3) 组装消息 → 4) agent 回答
 * → 5) 写回 Redis（剔 SystemMessage） → 6) 分类器决定写 Mem0 哪层。
 */
async function invokeWithMemory(agent, redisStore, mem0Store, sessionId, userText) {
  // ① 短期消息：从 Redis 拿当前会话最近几轮
  const history = await redisStore.loadMessages(sessionId);
  console.log(`  ↳ Redis 加载 ${history.length} 条历史`);

  // ② 长期记忆：并行查 user 层与 session 层
  const mem = await mem0Store.search(userText);
  if (mem.user.length) console.log(`  ↳ Mem0 用户层 ${mem.user.length} 条`);
  if (mem.session.length) console.log(`  ↳ Mem0 会话层 ${mem.session.length} 条`);

  // ③ 组装本轮 invoke 消息：
  //    [Mem0 记忆 SystemMessage(可选)] + [Redis 历史] + [用户本轮提问]
  const memoryMsg = mem0Store.buildSystemMessage(mem);
  const invokeMessages = [
    ...(memoryMsg ? [memoryMsg] : []),
    ...history,
    new HumanMessage(userText),
  ];

  // ④ 交给 agent；消息 ≥8 条时中间件会自动把早期消息压成摘要（内部完成）
  const result = await agent.invoke(
    { messages: invokeMessages },
    { recursionLimit: 30 },
  );

  // ⑤ 写回 Redis：剔除 Mem0 注入的 SystemMessage，再落库并刷新 TTL
  const redisMessages = messagesForRedis(result.messages);
  const dropped = result.messages.length - redisMessages.length;

  // —— 调试（DEBUG_SUMMARIZE=1）：查看本轮被压缩的消息与生成的摘要 ——
  if (DEBUG_SUMMARIZE) {
    // ① 定位摘要消息：langchain 压缩后早期消息会替换为一条带
    //    lc_source="summarization" 标记的 HumanMessage
    const summaryMsg = result.messages.find(
      (m) => m.additional_kwargs?.lc_source === "summarization",
    );
    if (summaryMsg) {
      // ② 被压缩的 = invoke 前 history 里有、本轮结果里已不存在的那几条
      const kept = new Set(
        result.messages
          .filter((m) => m.additional_kwargs?.lc_source !== "summarization")
          .map((m) => m.id),
      );
      const compressed = history.filter((m) => !kept.has(m.id));
      console.log("========== 本次摘要压缩明细 ==========");
      compressed.forEach((m) =>
        console.log(`  [${m._getType()}] ${String(m.content).slice(0, 120)}`),
      );
      // ③ 摘要正文：去掉消息开头固定的摘要前缀段（首个空行前）
      const text = String(summaryMsg.content);
      const sep = text.indexOf("\n\n");
      console.log("  生成摘要:", sep >= 0 ? text.slice(sep + 2) : text);
      console.log("======================================");
    }
  }

  await redisStore.saveMessages(sessionId, redisMessages);
  const ttl = await redisStore.ttl(sessionId);
  console.log(
    `  ↳ Redis 写回 ${redisMessages.length} 条` +
    (dropped ? `（过滤 ${dropped} 条 SystemMessage）` : "") +
    ` (TTL ${ttl}s)`,
  );

  // ⑥ 取助手最终回复文本，交给分类器判断「有没有新事实、写哪层」
  const assistantText = String(result.messages.at(-1)?.content ?? "");
  const { written, reason } = await mem0Store.classifyAndPersist(userText, assistantText);
  console.log(`  ↳ 分类: ${reason}`);
  console.log(written.length ? `  ↳ Mem0 写入: ${written.join(", ")}` : "  ↳ Mem0 未写入");

  return { messages: result.messages, redisMessages, assistantText };
}

// ============================================================================
// 启动前校验：两个云服务密钥缺一不可（Mem0 云端 + LLM）
// ============================================================================
if (!process.env.MEM0_API_KEY || !process.env.OPENAI_API_KEY) {
  console.error("需要 MEM0_API_KEY 与 OPENAI_API_KEY");
  process.exit(1);
}

// --- 建立两个客户端 ---
const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB }); // 短期消息
const mem0 = new MemoryClient({ apiKey: process.env.MEM0_API_KEY }); // 长期记忆（云端）

redis.on("connect", () => console.log("✅ Redis 已连接"));
redis.on("error", (err) => console.error("❌ Redis 错误:", err.message));

// Redis 连不上就直接退出，给出明确指引（避免后面一堆无关报错）
try {
  await redis.ping();
} catch {
  console.error("Redis 未连接，请先执行: docker compose up -d redis");
  process.exit(1);
}

// --- 短期记忆存储（Redis）---
const redisStore = new RedisMessageStore({
  redis,
  keyPrefix: KEY_PREFIX,
  ttlSeconds: MEMORY_TTL,
});

// --- 两个 LLM 共用同一套 OpenAI 兼容配置（temperature=0 保证稳定输出）---
const llmOpts = {
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
};

// ① 对话模型：负责真正跟用户聊天、生成回复与摘要
const model = new ChatOpenAI({ model: process.env.OPENAI_MODEL, ...llmOpts });

// ② 分类模型：同一底层模型套上 withStructuredOutput(memorySchema)，
//    强制返回符合 { write_user, write_session, reason } 结构的 JSON
const classifier = new ChatOpenAI({
  model: process.env.OPENAI_MODEL,
  ...llmOpts,
}).withStructuredOutput(memorySchema);

// --- 长期记忆存储（Mem0，user + session 双层）---
const mem0Store = new Mem0MemoryStore({
  client: mem0,
  userId: USER_ID,
  sessionId: SESSION_ID,
  topK: MEM0_TOP_K,
  classifier,
});

// --- Agent：无工具，仅靠中间件做摘要压缩 ---
const agent = createAgent({
  model,
  tools: [],
  systemPrompt:
    "你是会话助手。结合系统消息中的长期/会话记忆回答，中文简短。有对话摘要则据此继续。",
  middleware: [
    // summarizationMiddleware：Redis 短期消息达到阈值就自动压缩成摘要。
    // 触发计数细节（读自 langchain 源码 summarization.js）：trigger.messages 数的
    // 是 state.messages 的总条数，不区分 Human/AI/System/Tool——每轮注入的记忆
    // SystemMessage、agent 系统提示（若前置）都各占 1 条；每轮对话约 +2 条，
    // 所以「8 条」大致相当于 3~4 轮对话，而非 8 个用户提问。
    // keep 保留的是「拆掉首条 SystemMessage 后的真实对话」最近 4 条（自动对齐，
    // 不拆散 AI 工具调用与 ToolMessage）；多个 trigger 之间 OR、单 trigger 内
    // messages/tokens/fraction 为 AND，本项目只用 messages。
    summarizationMiddleware({
      model, // 摘要也用同一个对话模型生成
      summaryPrompt, // 摘要提示词
      trigger: { messages: 8 }, // 消息总量达到 8 条即触发（不分消息类型）
      keep: { messages: 4 }, // 压缩后保留最近 4 条真实对话 + 1 条摘要
    }),
  ],
});

console.log(`用户 ${USER_ID} | 会话 ${SESSION_ID}`);
console.log("输入 exit / quit / :q 退出；:clear 清空 Redis；:clear-mem0 清空 Mem0\n");

// --- 命令行交互 ---
const rl = readline.createInterface({ input: stdin, output: stdout });
// 记录当前已有消息条数，用于判断本轮是否触发过压缩
// （若新增消息数少于「历史+2」的规律，说明中间件已把旧消息换成摘要）
let prevCount = (await redisStore.loadMessages(SESSION_ID)).length;

try {
  while (true) {
    // 读一行用户输入；空行直接跳过
    const userText = (await rl.question("你: ")).trim();
    if (!userText) continue;

    // 退出指令
    if (["exit", "quit", ":q"].includes(userText.toLowerCase())) break;

    // 清空 Redis 短期记忆（保留 Mem0）
    if (userText === ":clear") {
      await redisStore.clear(SESSION_ID);
      prevCount = 0;
      console.log("已清空 Redis 短期记忆\n");
      continue;
    }

    // 清空 Mem0 用户层与当前会话层（保留 Redis）
    if (userText === ":clear-mem0") {
      await mem0Store.clear();
      console.log("已清空 Mem0 用户层与当前会话层\n");
      continue;
    }

    // 常规对话：走分层记忆 invoke
    const { redisMessages, assistantText } = await invokeWithMemory(
      agent,
      redisStore,
      mem0Store,
      SESSION_ID,
      userText,
    );

    console.log("\n助手:", assistantText);
    console.log(`Redis 消息数: ${redisMessages.length}`);
    // 判断本轮是否触发过摘要压缩：
    // 正常每轮 Redis 消息数固定 +2（新增用户 1 条 + 助手 1 条），应等于
    // prevCount + 2；一旦 summarizationMiddleware 把早期消息压成 1 条摘要，
    // 净增长会小于 2（甚至总条数变少），据此打印「已触发压缩」提示。
    if (redisMessages.length < prevCount + 2) {
      console.log("  ⚡ 已触发压缩");
    }
    prevCount = redisMessages.length;
    console.log();
  }
} finally {
  rl.close(); // 无论正常退出还是抛错，都关闭输入流
}

await redis.quit(); // 优雅关闭 Redis 连接，让进程正常退出

/*
 * 测试对话（复制进终端，先来 :clear-mem0 和 :clear）
 *
 * 一、寒暄
 * 你好 / 在吗 / 谢谢
 * → 纯客套，Mem0 不用记。
 *
 * 二、自我介绍
 * 我叫小明，住在杭州，平时喜欢骑行和摄影。
 * 我对海鲜过敏，出差尽量别安排沿海城市。
 * → 换天聊还得知道的事，写 user 层。
 *
 * 三、这会儿在干嘛
 * 这次我们先写 Q1 季度总结，大纲分三块：项目复盘、数据指标、下季度计划。
 * 项目复盘里重点写 order-service 的 500 错误排查过程。
 * → 只管这次聊天的事，写 session 层。
 *
 * 四、长期背景 + 手头活
 * 我长期做后端开发，这次会话的任务是排查 payment-api 超时，先从 P99 日志看起。
 * 另外我之后技术回答都希望带代码示例，这个一直记住。
 * → 职业和当前任务可能两层都写，偏好那条走 user。
 *
 * 五、Redis 和 Mem0 各管啥
 * 刚才说的 payment-api，超时阈值先假设 3 秒。
 * 上一句我说的阈值是多少？
 * → 刚说过的话 Redis 兜得住，不用等 Mem0。
 *
 * 重启 agent（别清 mem0）再问：我是谁？有什么过敏？
 * → 新会话 Redis 是空的，user 层还能认出你。
 *
 * 六、聊多了会压缩（可选，连聊 8 轮以上）
 * 继续完善 Q1 总结 / 把第二段改短 / 加个标题……
 * → 终端会出现「已触发压缩」，老消息变摘要。
 *
 * 推荐顺序：清空 → 寒暄 → 自我介绍 → 当前任务 → 重启验 user → 清 mem0 验 session 没了
 */
