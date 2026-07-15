/**
 * 记忆策略 1a：摘要总结（按消息数量触发）
 * 
 * 当对话历史的消息数超过阈值时，用 LLM 将旧消息压缩为摘要文本，
 * 仅保留最近 N 条原始消息 + 摘要，以此控制上下文长度。
 * 
 * 核心机制：
 * ┌──────────────────────────────────────────────────┐
 * │ 原始消息 [1,2,3,4,5,6,7,8,9,10] → 消息数=10     │
 * │   ↓ 分离                                          │
 * │ 旧消息 [1-8] → LLM 总结 → "讨论了红烧肉做法..."   │
 * │ 新消息 [9-10] → 保留原文                           │
 * │   ↓ 最终上下文                                     │
 * │ [摘要文本] + [消息9] + [消息10]                    │
 * └──────────────────────────────────────────────────┘
 * 
 * 参数：
 * - maxMessages=6：超过 6 条消息触发总结
 * - keepRecent=2：始终保留最近 2 条原始消息
 * 
 * @see summarization-memory2.mjs — 升级版：按 token 数量触发
 */
import 'dotenv/config';
import { ChatOpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { HumanMessage, SystemMessage, AIMessage, getBufferString } from "@langchain/core/messages";

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
 * 总结策略演示（按消息数量触发）
 * 
 * 模拟 10 条红烧肉教学对话，当消息数 ≥ 6 时：
 * 1. 保留最近 2 条原文（关于"收汁"的问答）
 * 2. 将前 8 条旧消息交给 LLM 压缩为摘要
 * 3. 清空 history 并重新写入 [摘要+最近2条]
 */
async function summarizationMemoryDemo() {
  // 2. 初始化历史存储
  const history = new InMemoryChatMessageHistory();
  const maxMessages = 6; // 触发阈值：超过 6 条消息时开始总结
  const keepRecent = 2;  // 始终保留最近 2 条原始消息不被总结

  // 3. 模拟一段完整的红烧肉教学对话（10 条消息）
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

  // 4. 将所有消息添加到历史
  for (const msg of messages) {
    if (msg.type === 'human') {
      await history.addMessage(new HumanMessage(msg.content));
    } else {
      await history.addMessage(new AIMessage(msg.content));
    }
  }

  let allMessages = await history.getMessages();
  
  console.log(`原始消息数量: ${allMessages.length}`);
  console.log("原始消息:", allMessages.map(m => `${m.constructor.name}: ${m.content}`).join('\n  '));
  
  // ========== 5. 判断是否触发总结 ==========
  if (allMessages.length >= maxMessages) {
    // 5a. 分离：最近 2 条保留原始内容，其余交给 LLM 总结
    const recentMessages = allMessages.slice(-keepRecent);
    const messagesToSummarize = allMessages.slice(0, -keepRecent);
    
    console.log("\n💡 历史消息过多，开始总结...");
    console.log(`📝 将被总结的消息数量: ${messagesToSummarize.length}`);
    console.log(`📝 将被保留的消息数量: ${recentMessages.length}`);
    
    // 5b. 调用 LLM 将旧消息压缩为摘要
    const summary = await summarizeHistory(messagesToSummarize);
    
    // 5c. 重建历史：清空后只保留最近消息（摘要可单独存储或拼入 prompt）
    await history.clear();
    for (const msg of recentMessages) {
      await history.addMessage(msg);
    }
    
    console.log(`\n保留消息数量: ${recentMessages.length}`);
    console.log("保留的消息:", recentMessages.map(m => `${m.constructor.name}: ${m.content}`).join('\n  '));
    console.log(`\n总结内容（前 ${messagesToSummarize.length} 条消息的摘要）: ${summary}`);
  } else {
    console.log("\n消息数量未超过阈值，无需总结");
  }
}

summarizationMemoryDemo().catch(console.error);

/**
 * 使用 LLM 将多条消息压缩为一段摘要文本
 * 
 * @param {Array<BaseMessage>} messages - 需要总结的消息数组
 * @returns {Promise<string>} 压缩后的摘要文本
 */
async function summarizeHistory(messages) {
  if (messages.length === 0) return "";
  
  // 使用 getBufferString 将消息数组格式化为人称对话文本
  const conversationText = getBufferString(messages, {
    humanPrefix: "用户",
    aiPrefix: "助手",
  });
  
  // 构造总结 prompt，要求 LLM 提取核心信息
  const summaryPrompt = `请总结以下对话的核心内容，保留重要信息：

${conversationText}

总结：`;
  
  // SystemMessage 包裹总结指令
  const summaryResponse = await model.invoke([new SystemMessage(summaryPrompt)]);
  return summaryResponse.content;
}
