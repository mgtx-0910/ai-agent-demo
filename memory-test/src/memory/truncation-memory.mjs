/**
 * 记忆策略 2：历史截断（Truncation Memory）
 * 
 * 截断是最简单的记忆管理策略：保留最近的 N 条消息，直接丢弃旧消息。
 * 相比总结策略，截断速度快、无需额外 LLM 调用，但会永久丢失早期信息。
 * 
 * 本文件演示两种截断方式：
 * 
 * ┌────────────────────┬───────────────────┬──────────────────────┐
 * │ 方式               │ 判定标准           │ 控制粒度             │
 * ├────────────────────┼───────────────────┼──────────────────────┤
 * │ 1. 按消息数量      │ maxMessages=4      │ 粗，每条消息不等长   │
 * │ 2. 按 Token 数量   │ maxTokens=100      │ 细，精确控制上下文   │
 * └────────────────────┴───────────────────┴──────────────────────┘
 * 
 * 核心 API：trimMessages() — LangChain 内置的截断工具
 * - strategy: "last" — 保留最近的（丢弃最早的）
 * - strategy: "first" — 保留最早的（丢弃最近的）
 * - tokenCounter — 自定义 token 计数函数
 * 
 * @see summarization-memory.mjs   — 不丢弃信息，改用总结替代
 * @see summarization-memory2.mjs  — 按 token 触发总结
 */
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { HumanMessage, AIMessage, trimMessages } from "@langchain/core/messages";
import { getEncoding } from "js-tiktoken";

// ==================== 方式 1：按消息数量截断 ====================
/**
 * 按消息数量截断：保留最近 maxMessages 条消息
 * 
 * 原理：allMessages.slice(-maxMessages) 直接切片，
 *       丢弃前半部分，保留尾部最近 N 条
 * 
 * 10 条消息 → 保留最近 4 条 → 丢失前 6 条（"我叫张三"、"我今年25岁"等信息永久丢失）
 */
async function messageCountTruncation() {
  const history = new InMemoryChatMessageHistory();
  const maxMessages = 4; // 只保留最近 4 条

  const messages = [
    { type: 'human', content: '我叫张三' },
    { type: 'ai', content: '你好张三，很高兴认识你！' },
    { type: 'human', content: '我今年25岁' },
    { type: 'ai', content: '25岁正是青春年华，有什么我可以帮助你的吗？' },
    { type: 'human', content: '我喜欢编程' },
    { type: 'ai', content: '编程很有趣！你主要用什么语言？' },
    { type: 'human', content: '我住在北京' },
    { type: 'ai', content: '北京是个很棒的城市！' },
    { type: 'human', content: '我的职业是软件工程师' },
    { type: 'ai', content: '软件工程师是个很有前景的职业！' },
  ];

  // 添加全部 10 条消息到历史
  for (const msg of messages) {
    if (msg.type === 'human') {
      await history.addMessage(new HumanMessage(msg.content));
    } else {
      await history.addMessage(new AIMessage(msg.content));
    }
  }

  let allMessages = await history.getMessages();

  // 截断：切片取最后 maxMessages 条
  // 原始：[msg1, msg2, ..., msg10] → 截断后：[msg7, msg8, msg9, msg10]
  const trimmedMessages = allMessages.slice(-maxMessages);
  console.log('='.repeat(60));
  console.log(`方式 1：按消息数量截断`);
  console.log('='.repeat(60));
  console.log(`保留消息数量: ${trimmedMessages.length}`);
  console.log("保留的消息:", trimmedMessages.map(m => `${m.constructor.name}: ${m.content}`).join('\n  '));
}


// ==================== 辅助函数：Token 计数 ====================
/**
 * 计算消息数组的总 token 数量
 * @param {Array<BaseMessage>} messages
 * @param {Tiktoken} encoder - cl100k_base 编码器
 * @returns {number}
 */
function countTokens(messages, encoder) {
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    total += encoder.encode(content).length;
  }
  return total;
}

// ==================== 方式 2：按 Token 数量截断 ====================
/**
 * 按 Token 数量截断（使用 js-tiktoken 精确计数）
 * 
 * 使用 LangChain 的 trimMessages() API：
 * - maxTokens: token 上限
 * - tokenCounter: 自定义计数函数（这里是 js-tiktoken）
 * - strategy: "last" — 从尾部保留，丢弃头部（保持最新上下文）
 * 
 * 相比手动 slice，trimMessages 自动计算需要保留多少条消息
 * 才能满足 maxTokens 约束
 */
async function tokenCountTruncation() {
  const history = new InMemoryChatMessageHistory();
  const maxTokens = 100; // token 预算上限

  // 使用 cl100k_base 编码器（GPT-4/3.5 使用，中文约 1~2 token/字）
  const enc = getEncoding("cl100k_base");

  const messages = [
    { type: 'human', content: '我叫李四' },
    { type: 'ai', content: '你好李四，很高兴认识你！' },
    { type: 'human', content: '我是一名设计师' },
    { type: 'ai', content: '设计师是个很有创造力的职业！你主要做什么类型的设计？' },
    { type: 'human', content: '我喜欢艺术和音乐' },
    { type: 'ai', content: '艺术和音乐都是很好的爱好，它们能激发创作灵感。' },
    { type: 'human', content: '我擅长 UI/UX 设计' },
    { type: 'ai', content: 'UI/UX 设计非常重要，好的用户体验能让产品更成功！' },
  ];

  // 添加全部 8 条消息
  for (const msg of messages) {
    if (msg.type === 'human') {
      await history.addMessage(new HumanMessage(msg.content));
    } else {
      await history.addMessage(new AIMessage(msg.content));
    }
  }

  let allMessages = await history.getMessages();

  // trimMessages 自动计算：从尾部累计，达到 maxTokens 时停止
  // strategy="last"：保留最新消息（从数组末尾往前取）
  const trimmedMessages = await trimMessages(allMessages, {
    maxTokens: maxTokens,
    tokenCounter: async (msgs) => countTokens(msgs, enc), // 自定义 token 计数
    strategy: "last", // 保留最近的消息（丢弃早期消息）
  });

  // 计算截断后的实际 token 使用量
  const totalTokens = countTokens(trimmedMessages, enc);
  console.log('='.repeat(60));
  console.log(`方式 2：按 Token 数量截断(使用trimMessages自动计算截断)`);
  console.log('='.repeat(60));
  console.log(`总 token 数: ${totalTokens}/${maxTokens}`);
  console.log(`保留消息数量: ${trimmedMessages.length}`);
  console.log("保留的消息:", trimmedMessages.map(m => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const tokens = enc.encode(content).length;
    return `${m.constructor.name} (${tokens} tokens): ${content}`;
  }).join('\n  '));

}

// ========== 串行执行两种截断策略对比 ==========
async function runAll() {
  await messageCountTruncation();
  await tokenCountTruncation();
}

runAll().catch(console.error);
