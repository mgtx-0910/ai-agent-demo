/**
 * 记忆策略 3：检索增强生成（RAG Retrieval Memory）
 * 
 * 与简单的上下文窗口不同，本策略将对话历史存入 Milvus 向量数据库，
 * 每次新对话时通过语义相似度检索最相关的历史，再拼入 prompt。
 * 
 * RAG 记忆工作流程（四步法）：
 * ┌─────────────────────────────────────────────────────────┐
 * │ 1. 用户输入 → 2. 向量化查询                              │
 * │ 3. Milvus 语义搜索 → 4. 检索结果注入 prompt → 模型生成   │
 * └─────────────────────────────────────────────────────────┘
 * 
 * 优势：
 * - 不依赖完整上下文窗口，可以处理大量历史
 * - 按语义相关性筛选，而非简单的时间顺序
 * - 新产生的对话自动向量化写回 Milvus，持续积累记忆
 * 
 * 前置条件：需先运行 insert-conversations.mjs 初始化基础对话数据
 * 
 * @see insert-conversations.mjs — 初始化 Milvus 对话数据
 */
import 'dotenv/config';
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const COLLECTION_NAME = 'conversations';
const VECTOR_DIM = 1024;

// ========== 1. 初始化 OpenAI Chat 模型 ==========
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// ========== 2. 初始化 Embeddings 模型 ==========
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  dimensions: VECTOR_DIM
});

// ========== 3. 初始化 Milvus 客户端 ==========
const client = new MilvusClient({
  address: process.env.MILVUS_HOST || "localhost:19530"
});

/**
 * 获取文本的向量嵌入（1024 维）
 * @param {string} text - 待编码文本
 * @returns {Promise<number[]>}
 */
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

/**
 * RAG 核心：从 Milvus 中按语义检索相关历史对话
 * 
 * 工作原理：
 * 1. 将用户当前输入 query 向量化
 * 2. 在 Milvus 中搜索向量最相似的 k 条历史记录
 * 3. 返回结果包含 content（对话原文）和 score（余弦相似度）
 * 
 * @param {string} query - 用户当前输入
 * @param {number} k - 返回最相似的 k 条记录（默认 2）
 * @returns {Promise<Array>} 包含 {id, content, round, score, ...} 的搜索结果
 */
async function retrieveRelevantConversations(query, k = 2) {
  try {
    // 将用户输入转为向量
    const queryVector = await getEmbedding(query);

    // COSINE 余弦相似度搜索：返回最相近的 k 条
    const searchResult = await client.search({
      collection_name: COLLECTION_NAME,
      vector: queryVector,        // 查询向量
      limit: k,                   // 返回条数
      metric_type: MetricType.COSINE, // 余弦相似度（1 = 完全相同，0 = 无关）
      output_fields: ['id', 'content', 'round', 'timestamp'] // 需要返回的标量字段
    });

    return searchResult.results;
  } catch (error) {
    console.error('检索对话时出错:', error.message);
    return [];
  }
}

/**
 * RAG 记忆策略完整演示
 * 
 * 三轮对话分别询问职业、爱好、项目等话题，
 * 每轮先检索 Milvus 中相关历史 → 注入 prompt → 模型回答 → 保存回 Milvus
 */
async function retrievalMemoryDemo() {
  // ========== 4. 连接 Milvus ==========
  try {
    console.log('连接到 Milvus...');
    await client.connectPromise;
    console.log('✓ 已连接\n');
  } catch (error) {
    console.error('❌ 无法连接到 Milvus:', error.message);
    console.log('请确保 Milvus 服务正在运行（localhost:19530）');
    return;
  }

  // 当前会话的历史缓存（内存中，非持久化）
  const history = new InMemoryChatMessageHistory();

  // 模拟三轮用户提问，分别考察不同话题的检索效果
  const conversations = [
    { input: "我之前提到的机器学习项目进展如何？" },  // 应命中 conv_002（机器学习）
    { input: "我周末经常做什么？" },                  // 应命中 conv_003/conv_004（爱好/电影）
    { input: "我的职业是什么？" },                    // 应命中 conv_001/conv_005（职业）
  ];

  for (let i = 0; i < conversations.length; i++) {
    const { input } = conversations[i];
    const userMessage = new HumanMessage(input);

    console.log(`\n[第 ${i + 1} 轮对话]`);
    console.log(`用户: ${input}`);

    // ========== 5. RAG Step 1：检索相关历史对话 ==========
    console.log('\n【检索相关历史对话】');
    const retrievedConversations = await retrieveRelevantConversations(input, 2);

    let relevantHistory = "";
    if (retrievedConversations.length > 0) {
      // 展示检索结果及相似度
      retrievedConversations.forEach((conv, idx) => {
        console.log(`\n[历史对话 ${idx + 1}] 相似度: ${conv.score.toFixed(4)}`);
        console.log(`轮次: ${conv.round}`);
        console.log(`内容: ${conv.content}`);
      });

      // ========== 6. RAG Step 2：构建增强 prompt ==========
      // 将检索到的历史对话拼入上下文
      relevantHistory = retrievedConversations
        .map((conv, idx) => {
          return `[历史对话 ${idx + 1}]
轮次: ${conv.round}
${conv.content}`;
        })
        .join('\n\n━━━━━\n\n');
    } else {
      console.log('未找到相关历史对话');
    }

    // ========== 7. RAG Step 3：注入检索结果到新 prompt ==========
    // 有相关历史时：将历史作为上下文 + 当前问题一并传给模型
    // 无相关历史时：直接传用户消息
    const contextMessages = relevantHistory
      ? [
        new HumanMessage(`相关历史对话：\n${relevantHistory}\n\n用户问题: ${input}`)
      ]
      : [userMessage];

    // ========== 8. RAG Step 4：模型生成回答 ==========
    console.log('\n【AI 回答】');
    const response = await model.invoke(contextMessages);

    // 保存当前对话到内存历史
    await history.addMessage(userMessage);
    await history.addMessage(response);

    // ========== 9. 将本轮对话写回 Milvus ==========
    // 实现"记忆积累"：本次对话也成为未来检索的素材
    const conversationText = `用户: ${input}\n助手: ${response.content}`;
    const convId = `conv_${Date.now()}_${i + 1}`;
    const convVector = await getEmbedding(conversationText);

    try {
      await client.insert({
        collection_name: COLLECTION_NAME,
        data: [{
          id: convId,
          vector: convVector,
          content: conversationText,
          round: i + 1,
          timestamp: new Date().toISOString()
        }]
      });
      console.log(`💾 已保存到 Milvus 向量数据库`);
    } catch (error) {
      console.warn('保存到向量数据库时出错:', error.message);
    }

    console.log(`助手: ${response.content}`);
  }
}

retrievalMemoryDemo().catch(console.error);
