/**
 * ebook-query.mjs — 电子书语义搜索脚本
 *
 * 功能：在 ebook_collection（天龙八部）集合中执行向量语义搜索。
 *       将自然语言问题向量化后，检索小说中最相关的内容片段。
 *
 * 流程：连接 Milvus → 加载集合 → 向量化查询 → TopK 搜索 → 打印结果
 */

import "dotenv/config";
import { MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';
import { OpenAIEmbeddings } from "@langchain/openai";

// ========== 常量配置 ==========
const COLLECTION_NAME = 'ebook_collection';  // 电子书向量集合
const VECTOR_DIM = 1024;

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

    // 确保集合已加载到内存（搜索的前提条件）
    try {
      await client.loadCollection({ collection_name: COLLECTION_NAME });
      console.log('✓ 集合已加载\n');
    } catch (error) {
      // 如果已经加载，重复 load 会报错，忽略即可
      if (!error.message.includes('already loaded')) {
        throw error;
      }
      console.log('✓ 集合已处于加载状态\n');
    }

    // ========== 向量语义搜索 ==========
    console.log('Searching for similar ebook content...');
    const query = '鸠摩智会什么武功？';
    console.log(`Query: "${query}"\n`);

    // 第一步：查询文本向量化
    const queryVector = await getEmbedding(query);

    // 第二步：在 Milvus 中搜索 TopK=5 个最相似的文本片段
    const searchResult = await client.search({
      collection_name: COLLECTION_NAME,
      vector: queryVector,
      limit: 5,
      metric_type: MetricType.COSINE,
      output_fields: ['id', 'book_id', 'chapter_num', 'index', 'content']
    });

    // 打印搜索结果，包含相似度分数和原文内容
    console.log(`Found ${searchResult.results.length} results:\n`);
    searchResult.results.forEach((item, index) => {
      console.log(`${index + 1}. [Score: ${item.score.toFixed(4)}]`);
      console.log(`   ID: ${item.id}`);
      console.log(`   Book ID: ${item.book_id}`);
      console.log(`   Chapter: 第 ${item.chapter_num} 章`);
      console.log(`   Index: ${item.index}`);
      console.log(`   Content: ${item.content}\n`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
