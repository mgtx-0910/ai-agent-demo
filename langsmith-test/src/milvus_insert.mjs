/**
 * 数据入库脚本：把 data/ 目录下的 .txt/.md 文档切块 + 向量化后写入 Milvus
 *
 * 流程：
 *   1. 读取 data/ 下所有 .txt/.md 文件
 *   2. RecursiveCharacterTextSplitter 切块（chunkSize=500, overlap=50）
 *   3. OpenAIEmbeddings 生成向量（默认 text-embedding-v3）
 *   4. 若集合已存在则先 drop，再 createCollection + createIndex + loadCollection
 *   5. 批量 insert 全部块，打印插入条数
 *
 * 运行：npm run insert  （或 node src/milvus_insert.mjs）
 */
import "dotenv/config";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { MilvusClient, DataType, IndexType, MetricType } from "@zilliz/milvus2-sdk-node";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";

/** Milvus 集合名（环境变量 MILVUS_COLLECTION，默认 rag_docs） */
const COLLECTION = process.env.MILVUS_COLLECTION ?? "rag_docs";
/** Milvus 地址：去掉协议前缀后交给 SDK（默认 localhost:19530） */
const MILVUS_ADDRESS =
  process.env.MILVUS_URI?.replace(/^https?:\/\//, "") ?? "localhost:19530";

/** 嵌入模型实例（阿里百炼兼容 OpenAI 协议） */
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDING_MODEL ?? "text-embedding-v3",
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
});

/** Milvus 客户端连接 */
const client = new MilvusClient({ address: MILVUS_ADDRESS });

/**
 * 读取数据目录下的 .txt/.md 文件并切块
 * @param {string} dataDir 数据目录路径
 * @returns {Promise<{pageContent: string, metadata: {source: string}}[]>} 切块后的文档列表
 */
async function loadChunks(dataDir = "./data") {
  if (!existsSync(dataDir)) {
    throw new Error(`数据目录不存在: ${dataDir}`);
  }
  const files = readdirSync(dataDir).filter((f) => /\.(txt|md)$/i.test(f));
  if (files.length === 0) {
    throw new Error(`目录内无 .txt/.md 文件: ${dataDir}`);
  }

  const docs = files.map((f) => ({
    pageContent: readFileSync(join(dataDir, f), "utf-8"),
    metadata: { source: f },
  }));

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });
  return splitter.splitDocuments(docs);
}

/** 主流程：连接 → 切块 → 建集合 → 建索引 → 载入 → 插入 */
async function main() {
  try {
    console.log("Connecting to Milvus...");
    await client.connectPromise;
    console.log("✓ Connected\n");

    const chunks = await loadChunks();

    if ((await client.hasCollection({ collection_name: COLLECTION })).value) {
      await client.dropCollection({ collection_name: COLLECTION });
      console.log(`Dropped collection: ${COLLECTION}\n`);
    }

    console.log("Generating embeddings...");
    const vectors = await embeddings.embedDocuments(
      chunks.map((c) => c.pageContent),
    );
    const dim = vectors[0].length;

    console.log("Creating collection...");
    await client.createCollection({
      collection_name: COLLECTION,
      fields: [
        {
          name: "langchain_primaryid",
          data_type: DataType.Int64,
          is_primary_key: true,
          autoID: true,
        },
        { name: "langchain_vector", data_type: DataType.FloatVector, dim },
        { name: "langchain_text", data_type: DataType.VarChar, max_length: 8000 },
        { name: "source", data_type: DataType.VarChar, max_length: 256 },
      ],
    });
    console.log("Collection created");

    console.log("\nCreating index...");
    await client.createIndex({
      collection_name: COLLECTION,
      field_name: "langchain_vector",
      index_type: IndexType.IVF_FLAT,
      metric_type: MetricType.L2,
      params: { nlist: 128 },
    });
    console.log("Index created");

    console.log("\nLoading collection...");
    await client.loadCollection({ collection_name: COLLECTION });
    console.log("Collection loaded");

    console.log("\nInserting...");
    const data = chunks.map((chunk, i) => ({
      langchain_text: chunk.pageContent,
      langchain_vector: vectors[i],
      source: chunk.metadata.source,
    }));

    const result = await client.insert({
      collection_name: COLLECTION,
      data,
    });
    console.log(`✓ Inserted ${result.insert_cnt} records\n`);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
