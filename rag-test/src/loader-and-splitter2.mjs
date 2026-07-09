/**
 * loader-and-splitter2.mjs — 完整的 RAG 流程：加载 → 分割 → 向量化 → 检索 → 生成
 *
 * 与 hello-rag.mjs 的区别：
 *   - 数据源来自真实网页（掘金文章），而非硬编码的示例文档
 *   - 演示了完整的 "网页爬取 → 文本分割 → 向量存储 → RAG 问答" 全链路
 *
 * 流程：
 *   1. 加载网页内容（CheerioWebBaseLoader）
 *   2. 切分为语义块（RecursiveCharacterTextSplitter）
 *   3. 向量化存入内存向量数据库（MemoryVectorStore）
 *   4. 根据问题检索相关文档块
 *   5. 用检索到的上下文增强 Prompt 交给 LLM 生成回答
 */

// 加载环境变量
import "dotenv/config";
// cheerio：服务端 HTML 解析
import "cheerio";
// LLM 聊天模型 + 文本向量化模型
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
// 递归文本分割器
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
// 内存向量存储
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
// Cheerio 网页加载器
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";

// ========== 1. 初始化 LLM 和向量化模型 ==========
const model = new ChatOpenAI({
  temperature: 0,
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  }
});

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  }
});

// ========== 2. 加载网页文档 ==========
const cheerioLoader = new CheerioWebBaseLoader(
  "https://juejin.cn/post/7233327509919547452",
  {
    selector: ".main-area p"  // 只提取文章正文段落
  }
);

const documents = await cheerioLoader.load();

// 确认加载成功
console.assert(documents.length === 1);
console.log(`Total characters: ${documents[0].pageContent.length}`);

// ========== 3. 文本分割 ==========
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,    // 每个分块最大字符数
  chunkOverlap: 50,  // 相邻分块重叠字符数（保持上下文连贯）
  separators: ["。", "！", "？"]  // 按中文句子结束符分割
});

const splitDocuments = await textSplitter.splitDocuments(documents);

console.log(splitDocuments);
console.log(`文档分割完成，共 ${splitDocuments.length} 个分块\n`);

// ========== 4. 创建向量存储 ==========
console.log("正在创建向量存储...");
const vectorStore = await MemoryVectorStore.fromDocuments(
  splitDocuments,
  embeddings
);
console.log("向量存储创建完成\n");

// 创建检索器，每次返回最相似的 2 个文档
const retriever = vectorStore.asRetriever({ k: 2 });

// ========== 5. 定义问题 ==========
const questions = ["父亲的去世对作者的人生态度产生了怎样的根本性逆转？"];

// ========== 6. RAG 主流程：检索 → 增强 → 生成 ==========
for (const question of questions) {
  console.log("=".repeat(80));
  console.log(`问题: ${question}`);
  console.log("=".repeat(80));

  // 检索：获取最相关文档及相似度评分
  const scoredResults = await vectorStore.similaritySearchWithScore(
    question,
    2
  );

  // 从带评分的检索结果中提取纯文档
  const retrievedDocs = scoredResults.map(([doc]) => doc);

  // 打印检索结果和相似度（1 表示完全相似）
  console.log("\n【检索到的文档及相似度评分】");
  scoredResults.forEach(([doc, score], i) => {
    const similarity = (1 - score).toFixed(4);

    console.log(`\n[文档 ${i + 1}] 相似度: ${similarity}`);
    console.log(`内容: ${doc.pageContent}`);
    if (doc.metadata && Object.keys(doc.metadata).length > 0) {
      console.log(`元数据:`, doc.metadata);
    }
  });

  // 增强：构建带上下文的 Prompt
  const context = retrievedDocs
    .map((doc, i) => `[片段${i + 1}]\n${doc.pageContent}`)
    .join("\n\n━━━━━\n\n");

  const prompt = `你是一个文章辅助阅读助手，根据文章内容来解答：

文章内容：
${context}

问题: ${question}

你的回答:`;

  // 生成：调用 LLM 回答
  console.log("\n【AI 回答】");
  const response = await model.invoke(prompt);
  console.log(response.content);
  console.log("\n");
}
