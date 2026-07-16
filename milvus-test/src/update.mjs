/**
 * update.mjs — Milvus 数据更新脚本
 *
 * 功能：演示如何更新已存在的向量数据。Milvus 不存在传统 UPDATE 语句，
 *       通过 upsert（存在则覆盖，不存在则插入）实现更新操作。
 *       将 diary_001 的内容、心情、标签全部替换，并重新生成向量。
 *
 * 流程：连接 Milvus → 构建新数据 → 生成新向量 → upsert 写入
 */

import "dotenv/config";
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { OpenAIEmbeddings } from "@langchain/openai";

// ========== 常量配置 ==========
const COLLECTION_NAME = 'ai_diary';
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
 * 获取文本的向量嵌入
 * @param {string} text - 待向量化的文本
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

    // ========== 通过 upsert 更新数据 ==========
    // 核心：提供相同的主键 id，新内容会覆盖旧记录
    console.log('Updating diary entry...');
    const updateId = 'diary_001';

    // 构建要更新的完整数据（必须包含所有字段，包括主键）
    const updatedContent = {
      id: updateId,
      content: '今天下了一整天的雨，心情很糟糕。工作上遇到了很多困难，感觉压力很大。一个人在家，感觉特别孤独。',
      date: '2026-01-10',
      mood: 'sad',
      tags: ['生活', '散步', '朋友']
    };

    // 为新内容重新生成向量（内容变了，向量也必须重新生成）
    console.log('Generating new embedding...');
    const vector = await getEmbedding(updatedContent.content);
    const updateData = { ...updatedContent, vector };

    // upsert: 主键存在则覆盖所有字段，不存在则当作新增插入
    const result = await client.upsert({
      collection_name: COLLECTION_NAME,
      data: [updateData]
    });

    console.log(`✓ Updated diary entry: ${updateId}`);
    console.log(`  New content: ${updatedContent.content}`);
    console.log(`  New mood: ${updatedContent.mood}`);
    console.log(`  New tags: ${updatedContent.tags.join(', ')}\n`);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
