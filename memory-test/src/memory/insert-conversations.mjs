/**
 * 记忆数据准备：将模拟对话数据插入 Milvus 向量数据库
 * 
 * 本文件为 retrieval-memory.mjs 提供基础数据。将 5 条虚构的对话历史
 * 写入 Milvus 集合 'conversations'，后续通过向量相似度检索相关历史。
 * 
 * 集合 Schema 设计：
 * ┌──────────┬───────────────┬──────────────────────────────┐
 * │ 字段     │ 类型          │ 说明                         │
 * ├──────────┼───────────────┼──────────────────────────────┤
 * │ id       │ VarChar(50)   │ 主键，唯一标识每条对话       │
 * │ vector   │ FloatVector   │ 1024维向量，content 的嵌入   │
 * │ content  │ VarChar(5000) │ 对话原文（用户+助手）        │
 * │ round    │ Int64         │ 对话轮次                     │
 * │ timestamp│ VarChar(100)  │ ISO 时间戳                   │
 * └──────────┴───────────────┴──────────────────────────────┘
 * 
 * 核心流程：
 * 1. 连接 Milvus → 2. 创建集合 → 3. 创建 IVF_FLAT 索引
 * 4. 加载集合 → 5. 并行生成向量嵌入 → 6. 批量插入
 * 
 * 向量维度：1024（text-embedding-v3 的默认输出维度）
 * 
 * @see retrieval-memory.mjs — 使用本文件插入的数据做 RAG 检索
 */
import "dotenv/config";
import { MilvusClient, DataType, MetricType, IndexType } from '@zilliz/milvus2-sdk-node';
import { OpenAIEmbeddings } from "@langchain/openai";

const COLLECTION_NAME = 'conversations';
const VECTOR_DIM = 1024; // text-embedding-v3 输出维度

// ========== 1. 初始化 Embeddings 模型 ==========
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  },
  dimensions: VECTOR_DIM
});

// ========== 2. 初始化 Milvus 客户端 ==========
const client = new MilvusClient({
  address: process.env.MILVUS_HOST || "localhost:19530"
});

/**
 * 获取文本的向量嵌入
 * @param {string} text - 需要编码的文本
 * @returns {Promise<number[]>} 1024 维向量数组
 */
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

/**
 * 主流程：连接 Milvus → 创建集合 → 创建索引 → 加载 → 插入数据
 */
async function main() {
  try {
    // ========== 3. 连接 Milvus ==========
    console.log('连接到 Milvus...');
    await client.connectPromise;
    console.log('✓ 已连接\n');

    // ========== 4. 创建集合（定义 Schema） ==========
    console.log('创建集合...');
    await client.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        // VarChar 主键：语义化 ID（如 conv_001）
        { name: 'id', data_type: DataType.VarChar, max_length: 50, is_primary_key: true },
        // FloatVector：文本的语义向量表示，用于相似度搜索
        { name: 'vector', data_type: DataType.FloatVector, dim: VECTOR_DIM },
        // 存储完整对话内容
        { name: 'content', data_type: DataType.VarChar, max_length: 5000 },
        // 对话轮次编号
        { name: 'round', data_type: DataType.Int64 },
        // 记录插入时间
        { name: 'timestamp', data_type: DataType.VarChar, max_length: 100 }
      ]
    });
    console.log('✓ 集合已创建');

    // ========== 5. 创建向量索引 ==========
    // IVF_FLAT：倒排索引，适合中小规模数据（< 百万级）
    // COSINE：余弦相似度，值越接近 1 越相似
    console.log('\n创建索引...');
    await client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'vector',
      index_type: IndexType.IVF_FLAT,
      metric_type: MetricType.COSINE
    });
    console.log('✓ 索引已创建');

    // ========== 6. 加载集合到内存 ==========
    // 集合加载后才能执行搜索操作
    console.log('\n加载集合...');
    await client.loadCollection({ collection_name: COLLECTION_NAME });
    console.log('✓ 集合已加载');

    // ========== 7. 准备模拟对话数据 ==========
    // 模拟一段完整对话历史，后续 RAG 检索时可匹配用户的相关问题
    console.log('\n插入对话数据...');
    const conversations = [
      {
        id: 'conv_001',
        content: '用户: 我叫赵六，是一名数据科学家\n助手: 很高兴认识你，赵六！数据科学是一个很有趣的领域。',
        round: 1,
        timestamp: new Date().toISOString()
      },
      {
        id: 'conv_002',
        content: '用户: 我最近在研究机器学习算法\n助手: 机器学习确实很有意思，你在研究哪些算法呢？',
        round: 2,
        timestamp: new Date().toISOString()
      },
      {
        id: 'conv_003',
        content: '用户: 我喜欢打篮球和看电影\n助手: 运动和文化娱乐都是很好的爱好！',
        round: 3,
        timestamp: new Date().toISOString()
      },
      {
        id: 'conv_004',
        content: '用户: 我周末经常去电影院\n助手: 看电影是很好的放松方式。',
        round: 4,
        timestamp: new Date().toISOString()
      },
      {
        id: 'conv_005',
        content: '用户: 我的职业是软件工程师\n助手: 软件工程师是个很有前景的职业！',
        round: 5,
        timestamp: new Date().toISOString()
      }
    ];

    // ========== 8. 并行生成向量嵌入并插入 ==========
    // Promise.all + map(async)：为每条对话并行生成向量，
    // 5 条数据 ≈ 1 次 API 调用耗时（最慢那条），而非 5 倍时间
    console.log('生成向量嵌入...');
    const conversationData = await Promise.all(
      conversations.map(async (conv) => ({
        ...conv,                        // 展开原始字段
        vector: await getEmbedding(conv.content)  // 生成向量
      }))
    );

    const insertResult = await client.insert({
      collection_name: COLLECTION_NAME,
      data: conversationData
    });
    console.log(`✓ 已插入 ${insertResult.insert_cnt} 条记录\n`);

    console.log('='.repeat(60));
    console.log('说明：已成功将对话数据插入到 Milvus 向量数据库');
    console.log('这些对话数据将用于后续的 RAG 检索');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('错误:', error.message);
  }
}

main();
