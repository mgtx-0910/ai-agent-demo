/**
 * loader-and-splitter.mjs — 网页文档加载与文本分割示例
 *
 * 功能：从掘金文章抓取内容，并将长文本按语义切分成小块（chunk）
 * 流程：
 *   1. 使用 CheerioWebBaseLoader 加载指定网页的正文内容
 *   2. 使用 RecursiveCharacterTextSplitter 按句子边界递归分割
 *   3. 输出分割后的文档块
 */

// 加载环境变量
import "dotenv/config";
// cheerio：服务端 jQuery，用于解析 HTML
import "cheerio";
// Cheerio 网页加载器：爬取网页并按 CSS 选择器提取内容
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
// 递归字符分割器：智能地将长文本按语义边界切分
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// ========== 1. 加载网页文档 ==========
// 从掘金文章抓取，CSS 选择器 ".main-area p" 提取正文段落
const cheerioLoader = new CheerioWebBaseLoader(
  "https://juejin.cn/post/7233327509919547452",
  {
    selector: ".main-area p"
  }
);

// 执行加载，返回包含网页内容的 Document 对象
const documents = await cheerioLoader.load();

// ========== 2. 文本分割 ==========
// 将长文档按语义边界切成小块，便于后续向量化和检索
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 400,    // 每个分块最大字符数
  chunkOverlap: 50,  // 相邻分块重叠的字符数（保持语义连贯）
  separators: ["。", "！", "？"]  // 优先按中文句子结束符分割
});

// 执行分割
const splitDocuments = await textSplitter.splitDocuments(documents);

// 输出分割结果
// console.log(documents);
console.log(splitDocuments);
