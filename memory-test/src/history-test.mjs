/**
 * 记忆策略演示：内存历史对话
 * 
 * 使用 LangChain 的 InMemoryChatMessageHistory 在内存中保存对话历史，
 * 每轮对话自动追加到历史记录，实现带上下文的连续对话。
 * 
 * 核心流程：
 * 1. 初始化 ChatOpenAI 模型 + InMemoryChatMessageHistory
 * 2. 每轮对话前从 history.getMessages() 获取完整历史
 * 3. 将 [systemMessage, ...历史消息] 拼接后传给模型
 * 4. 用户消息和 AI 回复都通过 history.addMessage() 追加到历史
 * 
 * 注意：InMemoryChatMessageHistory 仅在内存中保存，进程退出后数据丢失
 * 
 * @see history-test2.mjs — 使用 FileSystemChatMessageHistory 持久化到文件
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// ========== 1. 初始化 ChatOpenAI 模型 ==========
// temperature=0：确保回答稳定可复现，适合测试场景
const model = new ChatOpenAI({ 
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
  },
});

/**
 * 内存历史对话演示
 * 
 * 模拟两轮连续对话，第二轮能基于第一轮的上下文回答（如"好吃吗？"）
 * 原因：history 保存了全部消息，每轮都将完整历史拼入 prompt
 */
async function inMemoryDemo() {
  // 2. 初始化内存历史存储
  const history = new InMemoryChatMessageHistory();

  // 3. 设置系统提示词（角色设定）
  const systemMessage = new SystemMessage(
    "你是一个友好、幽默的做菜助手，喜欢分享美食和烹饪技巧。"
  );

  // ========== 4. 第一轮对话 ==========
  console.log("[第一轮对话]");
  const userMessage1 = new HumanMessage(
    "你今天吃的什么？"
  );
  await history.addMessage(userMessage1);  // 保存用户消息到历史
  
  // 拼接完整消息列表：[system, ...历史消息]
  const messages1 = [systemMessage, ...(await history.getMessages())];
  const response1 = await model.invoke(messages1);
  await history.addMessage(response1);  // 保存 AI 回复到历史
  
  console.log(`用户: ${userMessage1.content}`);
  console.log(`助手: ${response1.content}\n`);

  // ========== 5. 第二轮对话（基于历史记录） ==========
  // 此时 history 包含第 1 轮用户消息+AI 回复，
  // 所以 "好吃吗？" 能关联到上一轮的"吃的什么"
  console.log("[第二轮对话 - 基于历史记录]");
  const userMessage2 = new HumanMessage(
    "好吃吗？"
  );
  await history.addMessage(userMessage2);
  
  const messages2 = [systemMessage, ...(await history.getMessages())];
  const response2 = await model.invoke(messages2);
  await history.addMessage(response2);
  
  console.log(`用户: ${userMessage2.content}`);
  console.log(`助手: ${response2.content}\n`);

  // ========== 6. 展示所有历史消息 ==========
  console.log("[历史消息记录]");
  const allMessages = await history.getMessages();
  console.log(`共保存了 ${allMessages.length} 条消息：`);
  allMessages.forEach((msg, index) => {
    const type = msg.type;
    const prefix = type === 'human' ? '用户' : '助手';
    console.log(`  ${index + 1}. [${prefix}]: ${msg.content.substring(0, 50)}...`);
  });
}

inMemoryDemo().catch(console.error);