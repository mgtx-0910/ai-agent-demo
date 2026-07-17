/**
 * query.mjs — Milvus 向量搜索脚本
 *
 * 功能：将自然语言查询向量化，在 ai_diary 集合中执行余弦相似度搜索，
 *       返回语义上最匹配的日记条目
 *
 * 流程：连接 Milvus → 向量化查询 → 搜索 TopK → 打印结果及相似度分数
 *
 * @see insert.mjs — 创建 ai_diary 集合并写入数据
 * @see rag.mjs    — 基于搜索结果的 RAG 问答
 */

import "dotenv/config";
import { MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';
import { OpenAIEmbeddings } from "@langchain/openai";

// ========== 常量配置 ==========
const COLLECTION_NAME = 'ai_diary';  // 目标集合名称
const VECTOR_DIM = 1024;             // 向量维度

// ========== 初始化 Embedding 模型 ==========
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  },
  dimensions: VECTOR_DIM
});

// ========== 初始化 Milvus 客户端 ==========
const client = new MilvusClient({
  address: process.env.MILVUS_HOST || "localhost:19530"
});

/**
 * 将文本转换为向量嵌入
 * @param {string} text - 输入文本
 * @returns {number[]} 向量数组
 */
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

async function main() {
  try {
    console.log('Connecting to Milvus...');
    await client.connectPromise;
    console.log('✓ Connected\n');

    // ========== 向量语义搜索 ==========
    console.log('Searching for similar diary entries...');
    const query = '我做饭或学习的日记';
    console.log(`Query: "${query}"\n`);

    // 第一步：将查询文本向量化
    const queryVector = await getEmbedding(query);

    // 第二步：在 Milvus 中搜索 TopK 相似向量
    // limit: 返回最相似的 2 条
    // metric_type: COSINE（余弦相似度，值越接近 1 越相似）
    // output_fields: 指定返回的标量字段
    const searchResult = await client.search({
      collection_name: COLLECTION_NAME,
      vector: queryVector,
      limit: 2,
      metric_type: MetricType.COSINE,
      output_fields: ['id', 'content', 'date', 'mood', 'tags']
    });

    // 打印搜索结果及相似度分数
    console.log(`Found ${searchResult.results.length} results:\n`);
    searchResult.results.forEach((item, index) => {
      console.log(`${index + 1}. [Score: ${item.score.toFixed(4)}]`);
      console.log(`   ID: ${item.id}`);
      console.log(`   Date: ${item.date}`);
      console.log(`   Mood: ${item.mood}`);
      console.log(`   Tags: ${item.tags?.join(', ')}`);
      console.log(`   Content: ${item.content}\n`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
