/**
 * test.mjs —— 单独测试 DashScopeRerank 重排组件
 *
 * 不依赖 ES / Milvus，用手写的 3 条文档直接验证重排效果：
 * 与 query（"什么是文本排序模型"）越相关的文档应排在越前面。
 *
 * 运行：node src/rerank/test.mjs
 */
import "dotenv/config";
import { Document } from "@langchain/core/documents";
import { DashScopeRerank } from "./dashscope-rerank.mjs";

async function main() {
    // 复用 OPENAI_API_KEY 作为 DashScope 的 Bearer Token
    const apiKey = process.env.OPENAI_API_KEY;

    // 创建重排器：只保留 topN=3 条（这里刚好 3 条全保留，看的是排序变化）
    const compressor = new DashScopeRerank({ apiKey, topN: 3 });

    // 测试 query
    const query = "什么是文本排序模型";
    // 3 条候选文档：第 1 条与 query 强相关，第 2 条完全无关，第 3 条弱相关
    const docs = [
        new Document({
            pageContent:
                "预训练语言模型的发展给文本排序模型带来了新的进展",
        }),
        new Document({
            pageContent: "量子计算是计算科学的一个前沿领域",
        }),
        new Document({
            pageContent: "文本排序模型广泛用于搜索引擎和推荐系统中…",
        }),
    ];

    // 重排后应把相关文档排到前面（预期的理想顺序：0 → 2 → 1）
    const ranked = await compressor.compressDocuments(docs, query);
    console.log("重排后顺序（pageContent）：");
    for (const d of ranked) {
        console.log("-", d.pageContent);
    }
}

main()
  