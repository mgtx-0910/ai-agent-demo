/**
 * milvus_insert.mjs —— 数据入库脚本：文档切块 → 向量化 → 写入 Milvus
 *
 * 流程：
 *   1. 读取 data/ 下所有 .txt/.md 文件，每文件记为一条 Document（metadata.source 记录来源文件名）
 *   2. RecursiveCharacterTextSplitter 切块（chunkSize=500, overlap=50，语义相近段落不截断）
 *   3. OpenAIEmbeddings（默认 text-embedding-v3）为每个块生成向量
 *   4. 若集合 rag_docs 已存在则先 drop（保证幂等重建，避免脏数据）
 *   5. createCollection（主键/向量/文本/来源四个字段）→ createIndex（IVF_FLAT + L2）
 *   6. loadCollection（载入内存供查询）→ 批量 insert，打印插入条数
 *
 * 集合字段设计（字段名必须与 LangChain Milvus 向量库约定一致）：
 *   - langchain_primaryid：Int64 自增主键（LangChain 检索后反查文本用）
 *   - langchain_vector：FloatVector 向量列
 *   - langchain_text：原始文本内容
 *   - source：来源文件名（额外自定义字段，用于展示引用来源）
 *
 * 运行：npm run insert  （或 node src/milvus_insert.mjs）
 */
import "dotenv/config"; // 加载 .env 到 process.env
import { existsSync, readFileSync, readdirSync } from "fs"; // 文件系统：判断目录/读文件/列目录
import { join } from "path"; // 拼接路径
import { MilvusClient, DataType, IndexType, MetricType } from "@zilliz/milvus2-sdk-node"; // Milvus 原生 SDK（建表/索引/插入）
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"; // 递归字符切分器（保持段落/句子完整）
import { OpenAIEmbeddings } from "@langchain/openai"; // 嵌入模型（与 rag_agent.mjs 中保持一致）

/** Milvus 集合名（环境变量 MILVUS_COLLECTION，默认 rag_docs） */
const COLLECTION = process.env.MILVUS_COLLECTION ?? "rag_docs";
/**
 * Milvus 地址：
 * 原生 SDK 不需要协议前缀，因此把 env 里的 http:// / https:// 剥掉
 * （默认 localhost:19530，即 docker compose 默认映射端口）。
 */
const MILVUS_ADDRESS =
  process.env.MILVUS_URI?.replace(/^https?:\/\//, "") ?? "localhost:19530";

/** 嵌入模型实例（阿里百炼兼容 OpenAI 协议），模型须与检索侧一致 */
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDING_MODEL ?? "text-embedding-v3",
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
});

/** Milvus 客户端连接（单例，供建表/建索引/插入复用） */
const client = new MilvusClient({ address: MILVUS_ADDRESS });

/**
 * 读取数据目录下的 .txt/.md 文件并切块
 *
 * 实现要点：
 *  - 过滤出 .txt/.md 文件，每个文件包装成一条 Document（pageContent + metadata.source）
 *  - RecursiveCharacterTextSplitter 会先按段落、再按句子、最后按字符逐级切分，
 *    直到每块 ≤ chunkSize，同时相邻块保留 chunkOverlap 的字符重叠，避免语义被截断丢上下文
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

  // 每文件 → 一条原始文档，metadata 记录来源文件名，便于检索结果溯源
  const docs = files.map((f) => ({
    pageContent: readFileSync(join(dataDir, f), "utf-8"),
    metadata: { source: f },
  }));

  // 切块参数：500 字符/块、重叠 50 字符，适合中文客服文档
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });
  return splitter.splitDocuments(docs);
}

/**
 * 主流程：连接 → 切块 → 建集合 → 建索引 → 载入 → 插入
 * 任一步失败都会打印错误并以退出码 1 结束（便于 CI/脚本捕获）。
 */
async function main() {
  try {
    console.log("Connecting to Milvus...");
    await client.connectPromise; // 等待 TCP/gRPC 连接就绪
    console.log("✓ Connected\n");

    const chunks = await loadChunks();

    // 幂等重建：集合已存在先删除，保证每次入库都是干净数据
    if ((await client.hasCollection({ collection_name: COLLECTION })).value) {
      await client.dropCollection({ collection_name: COLLECTION });
      console.log(`Dropped collection: ${COLLECTION}\n`);
    }

    console.log("Generating embeddings...");
    // 批量向量化：一次请求生成全部块的向量
    const vectors = await embeddings.embedDocuments(
      chunks.map((c) => c.pageContent),
    );
    const dim = vectors[0].length; // 取第一块向量长度作为维度，建表时声明

    console.log("Creating collection...");
    // 建表：字段名与 LangChain Milvus 集成约定一致（langchain_* 前缀是官方命名）
    await client.createCollection({
      collection_name: COLLECTION,
      fields: [
        {
          name: "langchain_primaryid", // 主键：Int64 自增，LangChain 用它定位文档
          data_type: DataType.Int64,
          is_primary_key: true,
          autoID: true, // 由 Milvus 自动分配，无需应用侧维护
        },
        { name: "langchain_vector", data_type: DataType.FloatVector, dim }, // 向量列：维度=嵌入维度
        { name: "langchain_text", data_type: DataType.VarChar, max_length: 8000 }, // 原文（块内容，预留足够长）
        { name: "source", data_type: DataType.VarChar, max_length: 256 }, // 来源文件名（自定义展示字段）
      ],
    });
    console.log("Collection created");

    console.log("\nCreating index...");
    // 索引：IVF_FLAT 是经典的聚类倒排索引，召回快、精度高，适合中小规模数据集；
    // L2 欧式距离 + nlist=128 聚类中心数（默认权衡值）
    await client.createIndex({
      collection_name: COLLECTION,
      field_name: "langchain_vector",
      index_type: IndexType.IVF_FLAT,
      metric_type: MetricType.L2,
      params: { nlist: 128 },
    });
    console.log("Index created");

    console.log("\nLoading collection...");
    // 载入内存：Milvus 查询只在已 load 的集合上生效
    await client.loadCollection({ collection_name: COLLECTION });
    console.log("Collection loaded");

    console.log("\nInserting...");
    // 组装插入行：文本列 / 向量列 / 来源列 与建表字段一一对应
    const data = chunks.map((chunk, i) => ({
      langchain_text: chunk.pageContent,
      langchain_vector: vectors[i],
      source: chunk.metadata.source,
    }));

    const result = await client.insert({
      collection_name: COLLECTION,
      data,
    });
    console.log(`✓ Inserted ${result.insert_cnt} records\n`); // insert_cnt 为 SDK 返回的真实插入条数
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1); // 失败即退出非 0，方便脚本感知
  }
}

main();
