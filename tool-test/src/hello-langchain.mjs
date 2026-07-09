/**
 * hello-langchain.mjs — LangChain 入门示例
 *
 * 功能：最简化的 LangChain 调用，验证模型连接是否正常
 * 流程：
 *   1. 加载 .env 环境变量
 *   2. 初始化 ChatOpenAI 聊天模型
 *   3. 向模型发送 "介绍下自己" 并打印回复
 */

// 加载 .env 环境变量
import dotenv from 'dotenv';
// LangChain OpenAI 聊天模型
import { ChatOpenAI } from '@langchain/openai';

dotenv.config();

// 初始化聊天模型（temperature 默认为 1，让回答更有随机性）
const model = new ChatOpenAI({
    modelName: process.env.MODEL_NAME || "qwen-coder-turbo",
    apiKey: process.env.OPENAI_API_KEY,
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
    },
});

// 直接调用模型，invoke 返回 AIMessage 对象
const response = await model.invoke("介绍下自己");
console.log(response.content);
