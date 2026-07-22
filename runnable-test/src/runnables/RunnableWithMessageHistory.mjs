/**
 * RunnableWithMessageHistory - 自动注入和管理多轮对话历史
 * 
 * .withMessageHistory({ getMessageHistory }) 在每次 .invoke() 时自动：
 *   1. 从 ChatMessageHistory 中读取历史消息
 *   2. 将历史注入到 prompt 的 {history} 槽位（配合 MessagesPlaceholder）
 *   3. 执行 chain 后将本次对话追加回历史存储
 * 无需手动管理历史数组，自动实现带记忆的多轮对话。
 * 
 * @see ../../../prompt-template-test/src/messages-placeholder.mjs  — 基础：MessagesPlaceholder 占位原理
 */
import 'dotenv/config';
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0.3,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是一个简洁、有帮助的中文助手，会用 1-2 句话回答用户问题，重点给出明确、有用的信息。",
  ],
  new MessagesPlaceholder("history"),
  ["human", "{question}"],
]);

// 数据流向：{question} → prompt（自动注入 history）→ model → StringOutputParser → 回答文本
const simpleChain = prompt.pipe(model).pipe(new StringOutputParser());

// 内存中的会话历史存储：Map<sessionId, ChatMessageHistory>
const messageHistories = new Map();

const getMessageHistory = (sessionId) => {
  if (!messageHistories.has(sessionId)) {
    messageHistories.set(sessionId, new InMemoryChatMessageHistory());
  }
  return messageHistories.get(sessionId);
};

// 创建带消息历史的链：每次 invoke 自动读写历史
const chain = new RunnableWithMessageHistory({
  runnable: simpleChain,                           // 底层 chain：prompt → model → parser
  getMessageHistory: (sessionId) => getMessageHistory(sessionId), // 按 sessionId 获取历史
  inputMessagesKey: "question",                    // 将输入中的 question 字段作为新的人类消息
  historyMessagesKey: "history",                   // 历史消息注入到 prompt 的 {history} 占位符
});

// 测试：第一次对话
console.log('--- 第一次对话（提供信息） ---');
const result1 = await chain.invoke(
  {
    question: "我的名字是神光，我来自山东，我喜欢编程、写作、金铲铲。",
  },
  {
    configurable: {
      sessionId: "user-123",
    },
  }
);
console.log('问题: 我的名字是神光，我来自山东，我喜欢编程、写作、金铲铲。');
console.log('回答:', result1);
console.log();

// 测试：第二次对话
console.log('--- 第二次对话（询问之前的信息） ---');
const result2 = await chain.invoke(
  {
    question: "我刚才说我来自哪里？",
  },
  {
    configurable: {
      sessionId: "user-123",
    },
  }
);
console.log('问题: 我刚才说我来自哪里？');
console.log('回答:', result2);
console.log();

// 测试：第三次对话
console.log('--- 第三次对话（继续询问） ---');
const result3 = await chain.invoke(
  {
    question: "我的爱好是什么？",
  },
  {
    configurable: {
      sessionId: "user-123",
    },
  }
);
console.log('问题: 我的爱好是什么？');
console.log('回答:', result3);
console.log();
