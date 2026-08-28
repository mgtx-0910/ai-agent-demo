/**
 * dashscope-rerank.mjs —— 自定义 Rerank 压缩器（基于阿里云 DashScope 文本排序 API）
 *
 * 背景：ES 召回（关键词）和 Milvus 召回（语义）各自给出的排序只是「单路」的，
 * 合并后需要再用一个专门的「文本排序模型」对候选片段整体重排，
 * 把最相关的片段排到最前面，让 LLM 生成的答案质量更高。
 *
 * 实现要点：
 *   1. 继承 @langchain/core 的 BaseDocumentCompressor，只需实现 compressDocuments
 *   2. LangChain 的压缩器契约：compressDocuments(documents, query)
 *      → 返回按相关性重排后的 Document[] 子集
 *   3. 因此它可以无缝接进 ContextualCompressionRetriever，或在本项目里直接调用
 *   4. 调用 DashScope 的 rerank HTTP 接口，响应里每个结果带 index 字段，
 *      用 index 反查回原始 Document，确保 metadata 等信息不丢失
 *
 * 环境变量：RERANK_URL（API 地址）、OPENAI_API_KEY（复用为 Bearer Token）
 */
import "dotenv/config";
import { BaseDocumentCompressor } from "@langchain/core/retrievers/document_compressors";

export class DashScopeRerank extends BaseDocumentCompressor {

  /**
   * @param apiKey   阿里云 DashScope API Key（Bearer Token）
   * @param model    排序模型名，默认 qwen3-rerank
   * @param topN     重排后保留前多少条
   * @param baseUrl  接口地址，默认读环境变量 RERANK_URL
   */
  constructor({ apiKey, model, topN = 3, baseUrl } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model ?? process.env.RERANK_MODEL;
    this.topN = topN;
    this.baseUrl = baseUrl ?? process.env.RERANK_URL;
  }

  /**
   * 压缩器核心方法：把候选文档按与 query 的相关度重排，返回 topN 条。
   * @param documents 待重排的 Document[]（来自 ES + Milvus 合并结果）
   * @param query     用户问题（排序的参照）
   * @returns         按相关度从高到低排列的 Document[]，最多 topN 条
   */
  async compressDocuments(documents, query, _callbacks) {
    // 调用 DashScope 文本排序接口：POST 请求，输入 query + 所有候选文本
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: {
          query,
          // 只把 pageContent（正文文本）发给排序模型，metadata 留在本地
          documents: documents.map((d) => d.pageContent),
        },
        parameters: {
          return_documents: false, // 不重复返回文档文本，省流量
          top_n: this.topN, // 服务端就只返回前 topN 条的 index
        },
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        `DashScope rerank ${res.status}: ${JSON.stringify(json)}`,
      );
    }

    const results = json?.output?.results;
    if (!Array.isArray(results)) {
      throw new Error(`unexpected rerank response: ${JSON.stringify(json)}`);
    }

    // 服务端返回的每条结果是 { index, relevance_score }：
    // index 是传入 documents 数组的下标，用它反查回原始 Document（带 metadata）
    return results.map((item) => documents[item.index]);
  }
}
