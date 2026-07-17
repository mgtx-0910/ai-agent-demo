/**
 * 记忆策略 1b：摘要总结（按 Token 数量触发，升级版）
 * 
 * 相比 summarization-memory.mjs（按消息条数触发），本文件使用更精确的
 * token 计数来控制上下文大小，更贴近 LLM 上下文窗口限制的实际需求。
 * 
 * 为什么用 Token 而非消息条数：
 * - LLM 按 token 计费，不同语言 token 密度差异大
 * - 一条中文消息可能 30 token，英文可能 10 token
 * - 按 token 控制才能精确管理上下文窗口
 * 
 * 工作机制：
 * ┌────────────────────────────────────────────────────────┐
 * │ 总 tokens=250 → 超过阈值 maxTokens=200                 │
 * │   ↓ 从后往前累加                                       │
 * │ 保留最近消息（≤ keepRecentTokens=80 tokens）            │
 * │ 旧消息 → LLM 总结压缩                                  │
 * │   ↓ 最终上下文                                         │
 * │ [摘要] + [保留的最近消息（≤80 tokens）]                 │
 * └────────────────────────────────────────────────────────┘
 * 
 * Token 计数器：js-tiktoken 的 cl100k_base 编码（GPT-4/3.5 使用）
 * 
 * @see summarization-memory.mjs — 基础版：按消息数量触发
 */
import 'dotenv/config';
import { ChatOpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { HumanMessage, SystemMessage, AIMessage, getBufferString } from "@langchain/core/messages";
import { getEncoding } from "js-tiktoken";

// ========== 1. 初始化模型 ==========
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

/**
 * 计算消息数组的总 token 数量
 * 
 * cl100k_base 是 GPT-4/3.5-turbo 使用的 tokenizer，
 * 中文 1 字 ≈ 1~2 token，英文 1 词 ≈ 1~2 token
 * 
 * @param {Array<BaseMessage>} messages - 消息数组
 * @param {Tiktoken} encoder - tiktoken 编码器实例
 * @returns {number} 总 token 数
 */
function countTokens(messages, encoder) {
  let total = 0;
  for (const msg of messages) {
    // 兼容 content 为 string 或数组（多模态）的情况
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    total += encoder.encode(content).length;
  }
  return total;
}

/**
 * 总结策略演示（基于 token 计数触发）
 * 
 * 参数：
 * - maxTokens=200：累计超过 200 个 token 触发总结
 * - keepRecentTokens=80：保留最近约 80 token 的原始消息
 */
async function summarizationMemoryDemo() {
  const history = new InMemoryChatMessageHistory();
  const maxTokens = 200;        // 触发总结的 token 阈值
  const keepRecentTokens = 80;  // 保留最近消息的 token 预算

  // 2. 初始化 tiktoken 编码器（cl100k_base = GPT-4/3.5 的 tokenizer）
  const enc = getEncoding("cl100k_base");

  // 3. 模拟红烧肉教学对话（与 summarization-memory.mjs 相同）
  const messages = [
    { type: 'human', content: '我想学做红烧肉，你能教我吗？' },
    { type: 'ai', content: '当然可以！红烧肉是一道经典的中式菜肴。首先需要准备五花肉、冰糖、生抽、老抽、料酒等材料。' },
    { type: 'human', content: '五花肉需要切多大块？' },
    { type: 'ai', content: '建议切成3-4厘米见方的块，这样既容易入味，口感也更好。切好后可以用开水焯一下去除血沫。' },
    { type: 'human', content: '炒糖色的时候有什么技巧吗？' },
    { type: 'ai', content: '炒糖色是关键步骤。用小火慢慢炒，等冰糖完全融化变成焦糖色，冒小泡时就可以下肉了。注意不要炒过头，否则会发苦。' },
    { type: 'human', content: '需要炖多长时间？' },
    { type: 'ai', content: '一般需要炖40-60分钟，用小火慢炖，直到肉变得软糯入味。可以用筷子戳一下，能轻松戳透就说明好了。' },
    { type: 'human', content: '最后收汁的时候要注意什么？' },
    { type: 'ai', content: '收汁时要用大火，不断翻动，让汤汁均匀包裹在肉块上。看到汤汁变得浓稠，颜色红亮就可以出锅了。' },
  ];

  // 4. 添加所有消息
  for (const msg of messages) {
    if (msg.type === 'human') {
      await history.addMessage(new HumanMessage(msg.content));
    } else {
      await history.addMessage(new AIMessage(msg.content));
    }
  }

  let allMessages = await history.getMessages();

  const totalTokens = countTokens(allMessages, enc);

  // ========== 5. 按 token 阈值判断是否触发总结 ==========
  if (totalTokens >= maxTokens) {
    // 5a. 从后往前遍历，保留最近的消息直到达到 keepRecentTokens 预算
    const recentMessages = [];
    let recentTokens = 0;

    // 反向遍历：从最新消息开始累加
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msg = allMessages[i];
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const msgTokens = enc.encode(content).length;

      // 如果加入当前消息仍未超过保留预算，则保留
      if (recentTokens + msgTokens <= keepRecentTokens) {
        recentMessages.unshift(msg); // unshift 保持原始时间顺序
        recentTokens += msgTokens;
      } else {
        break; // 预算用完，停止保留, 终止整个循环
      }
    }

    // 5b. 剩余的旧消息交给 LLM 总结
    const messagesToSummarize = allMessages.slice(0, allMessages.length - recentMessages.length);
    const summarizeTokens = countTokens(messagesToSummarize, enc);

    console.log("\n💡 Token 数量超过阈值，开始总结...");
    console.log(`📝 将被总结的消息数量: ${messagesToSummarize.length} (${summarizeTokens} tokens)`);
    console.log(`📝 将被保留的消息数量: ${recentMessages.length} (${recentTokens} tokens)`);

    // 5c. LLM 压缩旧消息
    const summary = await summarizeHistory(messagesToSummarize);

    // 5d. 重建历史：清空后只写入保留的最近消息
    await history.clear();
    for (const msg of recentMessages) {
      await history.addMessage(msg);
    }

    console.log(`\n保留消息数量: ${recentMessages.length}`);
    console.log("保留的消息:", recentMessages.map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const tokens = enc.encode(content).length;
      return `${m.constructor.name} (${tokens} tokens): ${m.content}`;
    }).join('\n  '));
    console.log(`\n总结内容（${summarizeTokens} tokens 压缩后）: ${summary}`);
  } else {
    console.log(`\nToken 数量 (${totalTokens}) 未超过阈值 (${maxTokens})，无需总结`);
  }
}

summarizationMemoryDemo().catch(console.error);

// 总结历史对话的函数
async function summarizeHistory(messages) {
  if (messages.length === 0) return "";

  const conversationText = getBufferString(messages, {
    humanPrefix: "用户",
    aiPrefix: "助手",
  });

  const summaryPrompt = `请总结以下对话的核心内容，保留重要信息：

${conversationText}

总结：`;

  // 用 SystemMessage 而非 HumanMessage：总结是给模型的"任务指令"，不是对话内容。
  // SystemMessage 优先级更高，确保模型把它当作指令执行，而非当作对话来回应。
  const summaryResponse = await model.invoke([new SystemMessage(summaryPrompt)]);
  return summaryResponse.content;
}
