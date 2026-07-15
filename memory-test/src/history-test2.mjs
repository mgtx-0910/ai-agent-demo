/**
 * 记忆策略演示：文件持久化历史对话
 * 
 * 相比 history-test.mjs 的 InMemoryChatMessageHistory（内存存储，进程退出即丢失），
 * 本文件使用 FileSystemChatMessageHistory 将对话保存到 JSON 文件持久化。
 * 
 * 关键参数：
 * - filePath：JSON 文件的存储路径（默认项目根目录 chat_history.json）
 * - sessionId：会话标识，同一 sessionId 共享历史，不同 sessionId 相互隔离
 * 
 * 核心流程：
 * 1. 初始化 ChatOpenAI 模型 + FileSystemChatMessageHistory
 * 2. 两轮连续对话，每轮追加到文件
 * 3. 对话内容自动序列化保存到 chat_history.json
 * 
 * @see history-test3.mjs — 从文件恢复历史并继续对话
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { FileSystemChatMessageHistory } from "@langchain/community/stores/message/file_system";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import path from "node:path";

// ========== 1. 初始化 ChatOpenAI 模型 ==========
const model = new ChatOpenAI({ 
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
  },
});

/**
 * 文件历史对话演示
 * 两轮对话均以增量方式写入同一个 JSON 文件
 */
async function fileHistoryDemo() {
  // 2. 指定存储路径与 sessionId
  // filePath: JSON 存储文件路径
  // sessionId: 用于区分不同用户的对话记录
  const filePath = path.join(process.cwd(), "chat_history.json");
  const sessionId = "user_session_001";

  // 3. 设置系统提示词（角色设定）
  const systemMessage = new SystemMessage(
    "你是一个友好的做菜助手，喜欢分享美食和烹饪技巧。"
  );

  // ========== 4. 第一轮对话 ==========
  console.log("[第一轮对话]");
  // 创建文件历史存储实例（首次创建，如果文件存在则追加）
  const history = new FileSystemChatMessageHistory({
    filePath: filePath,
    sessionId: sessionId,
  });

  const userMessage1 = new HumanMessage(
    "红烧肉怎么做"
  );
  await history.addMessage(userMessage1);
  
  const messages1 = [systemMessage, ...(await history.getMessages())];
  const response1 = await model.invoke(messages1);
  await history.addMessage(response1);
  
  console.log(`用户: ${userMessage1.content}`);
  console.log(`助手: ${response1.content}`);
  console.log(`✓ 对话已保存到文件: ${filePath}\n`);

  // ========== 5. 第二轮对话（自动读取已有历史） ==========
  console.log("[第二轮对话]");
  const userMessage2 = new HumanMessage(
    "好吃吗？"
  );
  await history.addMessage(userMessage2);
  
  // 拼接 system + 完整历史消息（含第一轮），实现上下文连贯
  const messages2 = [systemMessage, ...(await history.getMessages())];
  const response2 = await model.invoke(messages2);
  await history.addMessage(response2);
  
  console.log(`用户: ${userMessage2.content}`);
  console.log(`助手: ${response2.content}`);
  console.log(`✓ 对话已更新到文件\n`);
}

fileHistoryDemo().catch(console.error);