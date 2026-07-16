/**
 * insert.mjs — Milvus 数据插入脚本
 *
 * 功能：创建 ai_diary 集合、建立 IVF_FLAT + COSINE 索引，
 *       将 5 条模拟日记文本向量化后批量写入 Milvus
 *
 * 流程：连接 Milvus → 创建集合 → 创建索引 → 加载集合 → 向量化 → 插入
 */

import "dotenv/config";
import { MilvusClient, DataType, MetricType, IndexType } from '@zilliz/milvus2-sdk-node';
import { OpenAIEmbeddings } from "@langchain/openai";

// ========== 常量配置 ==========
const COLLECTION_NAME = 'ai_diary';  // Milvus 集合名称
const VECTOR_DIM = 1024;             // 向量维度（需与 Embedding 模型输出一致）

// ========== 初始化 Embedding 模型 ==========
// 将文本转换为固定维度的浮点向量，用于后续语义搜索
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  },
  dimensions: VECTOR_DIM
});

// ========== 初始化 Milvus 客户端 ==========
// 连接本地 Milvus 服务（默认端口 19530）
const client = new MilvusClient({
  address: process.env.MILVUS_HOST || "localhost:19530"
});

/**
 * 获取文本的向量嵌入
 * @param {string} text - 待向量化的文本
 * @returns {number[]} 1024 维浮点向量
 */
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

async function main() {
  try {
    // ========== 1. 连接 Milvus ==========
    console.log('Connecting to Milvus...');
    await client.connectPromise;
    console.log('✓ Connected\n');

    // ========== 2. 创建集合（Collection）= Milvus 中的"表" ==========
    // 定义了 id（主键）、vector（向量字段）、content/date/mood/tags（标量字段）
    console.log('Creating collection...');
    await client.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        { name: 'id', data_type: DataType.VarChar, max_length: 50, is_primary_key: true },
        { name: 'vector', data_type: DataType.FloatVector, dim: VECTOR_DIM },
        { name: 'content', data_type: DataType.VarChar, max_length: 5000 },
        { name: 'date', data_type: DataType.VarChar, max_length: 50 },
        { name: 'mood', data_type: DataType.VarChar, max_length: 50 },
        { name: 'tags', data_type: DataType.Array, element_type: DataType.VarChar, max_capacity: 10, max_length: 50 }
      ]
    });
    console.log('Collection created');

    // ========== 3. 创建向量索引 ==========
    // IVF_FLAT：倒排文件索引，nlist=1024 表示将向量空间划分为 1024 个聚类
    // COSINE：使用余弦相似度衡量向量间距离
    console.log('\nCreating index...');
    await client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'vector',
      index_type: IndexType.IVF_FLAT,
      metric_type: MetricType.COSINE,
      params: { nlist: 1024 }
    });
    console.log('Index created');

    // ========== 4. 将集合加载到内存（搜索前必须加载） ==========
    console.log('\nLoading collection...');
    await client.loadCollection({ collection_name: COLLECTION_NAME });
    console.log('Collection loaded');

    // ========== 5. 准备并插入数据 ==========
    console.log('\nInserting diary entries...');
    const diaryContents = [
      {
        id: 'diary_001',
        content: '今天天气很好，去公园散步了，心情愉快。看到了很多花开了，春天真美好。',
        date: '2026-01-10',
        mood: 'happy',
        tags: ['生活', '散步']
      },
      {
        id: 'diary_002',
        content: '今天工作很忙，完成了一个重要的项目里程碑。团队合作很愉快，感觉很有成就感。',
        date: '2026-01-11',
        mood: 'excited',
        tags: ['工作', '成就']
      },
      {
        id: 'diary_003',
        content: '周末和朋友去爬山，天气很好，心情也很放松。享受大自然的感觉真好。',
        date: '2026-01-12',
        mood: 'relaxed',
        tags: ['户外', '朋友']
      },
      {
        id: 'diary_004',
        content: '今天学习了 Milvus 向量数据库，感觉很有意思。向量搜索技术真的很强大。',
        date: '2026-01-12',
        mood: 'curious',
        tags: ['学习', '技术']
      },
      {
        id: 'diary_005',
        content: '晚上做了一顿丰盛的晚餐，尝试了新菜谱。家人都说很好吃，很有成就感。',
        date: '2026-01-13',
        mood: 'proud',
        tags: ['美食', '家庭']
      }
    ];

    // ========== 6. 并行生成向量（关键优化） ==========
    // map(async) 对每个 diary 同步调用 getEmbedding，最终返回 Promise 数组
    // Promise.all 等待所有 Promise 完成后，返回带 vector 字段的完整数组
    // 5 条数据 ≈ 1 次 API 调用时间（最慢的那个），而非 5 次累加
    console.log('Generating embeddings...');
    const diaryData = await Promise.all(
      diaryContents.map(async (diary) => ({
        ...diary,
        vector: await getEmbedding(diary.content)
      }))
    );

    const insertResult = await client.insert({
      collection_name: COLLECTION_NAME,
      data: diaryData
    });
    console.log(`✓ Inserted ${insertResult.insert_cnt} records\n`);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
