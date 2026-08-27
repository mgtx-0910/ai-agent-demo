/**
 * 查询扩展（Query Augmentation）：把用户问题交给 LLM 改写成 3 条不同角度的检索问句。
 *
 * 为什么需要扩展？单个问题表述可能太口语、太宽泛，直接拿去检索容易漏召回。
 * 扩写成多角度问句后，每条各走一次 ES（关键词）和 Milvus（语义），最后合并去重，
 * 能显著提升召回率。
 *
 * 本文件只负责「生成问句」和「整理检索串」：
 *   - augmentQuery            : LLM 结构化输出 3 条问句（带失败兜底）
 *   - retrievalQueryStrings   : 原始问题 + 扩展问句拼成最终的检索串列表
 */
import { ChatPromptTemplate } from "@langchain/core/prompts";
import * as z from "zod";

// zod 定义结构化输出：恰好 3 条中文检索问句
export const QueryAugmentationSchema = z.object({
  queries: z
    .array(z.string())
    .length(3)
    .describe(
      "恰好 3 条中文检索问句：不同角度改写或扩写；保留订单号、品牌等字面信息；不要编造事实",
    ),
});

const AUGMENT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `用户会给出一句中文问题。请另外写出恰好 3 条检索用的问句（与原意一致、角度尽量不同），便于搜索引擎或向量库分别召回：
可改写说法、换提问角度、或略加限定词；专有名词、型号、订单号等必须保留原样。
只输出结构化字段 queries（长度为 3 的字符串数组）。`,
  ],
  ["human", "{query}"],
]);

/**
 * 规范化 LLM 返回的问句列表：保证恰好 3 条非空问句。
 * 策略：去掉空串 → 不够 3 条用原问题补位 → 超过 3 条截断。
 * 这样下游（retrievalQueryStrings）拿到的永远是结构稳定的数组。
 */
function normalizeThreeQueries(original, list) {
  const out = (list ?? [])
    .map((s) => (typeof s === "string" ? s.trim() : "")) // 去空白
    .filter(Boolean); // 去空串
  while (out.length < 3) out.push(original); // 不足 3 条用原问题补位
  return out.slice(0, 3); // 超过 3 条截断
}

/**
 * 执行查询扩展：ChatPromptTemplate（提示词）→ withStructuredOutput（强制 JSON）
 * 链式调用 chain.invoke({ query })，得到符合 Schema 的 { queries: [...] }。
 * LLM 调用失败时兜底：返回空列表，由 normalizeThreeQueries 用原问题补满 3 条，
 * 保证主流程（hybrid-retrieval）不会因扩展失败而中断。
 */
export async function augmentQuery(chatModel, query) {
  const structured = chatModel.withStructuredOutput(QueryAugmentationSchema);
  const chain = AUGMENT_PROMPT.pipe(structured);
  try {
    const raw = await chain.invoke({ query });
    return { queries: normalizeThreeQueries(query, raw.queries) };
  } catch {
    return { queries: normalizeThreeQueries(query, []) };
  }
}

/** 原始问题在前，其后接 LLM 生成的问句；不做去重，顺序固定；每条各跑一次 ES、Milvus */
export function retrievalQueryStrings(original, augmentation) {
  return [original, ...(augmentation?.queries ?? [])]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
}
