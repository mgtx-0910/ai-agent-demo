/**
 * 记忆策略演示：从文件恢复历史并继续对话
 * 
 * 在 history-test2.mjs 完成两轮对话并持久化到 chat_history.json 后，
 * 本文件演示如何从同一文件恢复历史，并继续进行第三轮对话。
 * 
 * 核心流程：
 * 1. 用相同的 filePath + sessionId 创建 FileSystemChatMessageHistory
 * 2. getMessages() 自动从 JSON 文件反序列化已有 4 条历史消息
 * 3. 在历史基础上继续第三轮对话（"需要哪些食材？" 能关联红烧肉上下文）
 * 4. 新消息以增量方式追加到同一文件
 * 
 * 要点：同一个 filePath + sessionId 下的对话具有连续性，
 *       不同 sessionId 之间的历史相互隔离
 * 
 * @see history-test2.mjs — 首次创建并保存对话
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { FileSystemChatMessageHistory } from "@langchain/community/stores/message/file_system";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
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
 * 恢复文件历史并继续对话演示
 * 模拟程序重启后，使用相同 sessionId 恢复历史上下文
 */
async function fileHistoryDemo() {
  // 2. 使用相同的 filePath + sessionId 恢复已有历史
  const filePath = path.join(process.cwd(), "chat_history.json");
  const sessionId = "user_session_001";

  // 3. 系统提示词
  const systemMessage = new SystemMessage(
    "你是一个友好、幽默的做菜助手，喜欢分享美食和烹饪技巧。"
  );

  // 4. 从文件恢复历史消息（读取 chat_history.json）
  const restoredHistory = new FileSystemChatMessageHistory({
    filePath: filePath,
    sessionId: sessionId,
  });
  
  // getMessages() 自动从 JSON 反序列化已有消息
  const restoredMessages = await restoredHistory.getMessages();
  console.log(`从文件恢复了 ${restoredMessages.length} 条历史消息：`);
  restoredMessages.forEach((msg, index) => {
    const type = msg.type;
    const prefix = type === 'human' ? '用户' : '助手';
    console.log(`  ${index + 1}. [${prefix}]: ${msg.content.substring(0, 50)}...`);
  });
  console.log();

  // ========== 5. 第三轮对话（基于恢复的历史） ==========
  // history-test2.mjs 中讨论了红烧肉做法，这里继续追问食材，
  // 模型能基于 history-test2.mjs 中的上下文回答
  console.log("[第三轮对话]");
  const userMessage3 = new HumanMessage(
    "需要哪些食材？"
  );
  await restoredHistory.addMessage(userMessage3);
  
  const messages3 = [systemMessage, ...(await restoredHistory.getMessages())];
  const response3 = await model.invoke(messages3);
  await restoredHistory.addMessage(response3);  // 增量追加到文件
  
  console.log(`用户: ${userMessage3.content}`);
  console.log(`助手: ${response3.content}`);
  console.log(`✓ 对话已保存到文件\n`);
}

fileHistoryDemo().catch(console.error);