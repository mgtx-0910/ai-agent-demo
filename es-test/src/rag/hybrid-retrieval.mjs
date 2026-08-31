/**
 * 混合检索：LLM 重写为 3 条多角度问句 → 每条问句分别 ES + Milvus → 全量合并去重 → Rerank → LLM 作答。
 * LangGraph：START → query_augment → es_recall ∥ milvus_recall → merge → rerank → generate_answer → END。
 */
import "dotenv/config";
import { Client } from "@elastic/elasticsearch";
import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Milvus } from "@langchain/community/vectorstores/milvus";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { DashScopeRerank } from "../rerank/dashscope-rerank.mjs";
import {
  augmentQuery,
  retrievalQueryStrings,
} from "./query-augment.mjs";

const INDEX = "life_notes";

/**
 * 图状态定义（LangGraph 白名单制：节点返回的字段必须在此声明，否则被丢弃）：
 *   query            : 用户原始问题
 *   queryAugmentation: LLM 生成的 3 条多角度检索问句（query-augment.mjs 输出）
 *   esHits           : ES 全文检索命中的 Document[]
 *   milvusHits       : Milvus 向量检索命中的 Document[]
 *   merged           : ES + Milvus 合并去重后的 Document[]
 *   topDocuments     : Rerank 重排后保留的 Document[]（最终上下文）
 *   answer           : LLM 生成的最终回答
 */
const HybridRetrievalState = Annotation.Root({
  query: Annotation(),
  queryAugmentation: Annotation(),
  esHits: Annotation(),
  milvusHits: Annotation(),
  merged: Annotation(),
  topDocuments: Annotation(),
  answer: Annotation(),
});

/**
 * 把 ES 命中的原始 hit 转成 LangChain Document：
 *   - pageContent：标题 + 正文拼成一段文本
 *   - metadata    ：保留 _id 和 source='es'，方便跨库去重与标注来源
 */
function docFromEsHit(hit) {
  const s = hit._source ?? {};
  const text = [s.note_title ?? s.title, s.note_body ?? s.content]
    .filter(Boolean)
    .join("\n");
  return new Document({
    pageContent: text,
    metadata: { id: hit._id, source: "es", ...s },
  });
}

/** ES 与 Milvus 结果拼接后仅按 metadata.id 去重，保留首次出现（通常 ES 在前） */
function merge(esDocs, milvusDocs) {
  const combined = [...(esDocs ?? []), ...(milvusDocs ?? [])].filter(
    (d) => d?.pageContent,
  );
  return dedupeDocsById(combined);
}

/** 去重键仅为 metadata.id（trim 后非空）；无 id 丢弃，不按正文去重；保留首次出现顺序 */
function dedupeDocsById(docs) {
  const seen = new Set();
  const out = [];
  for (const d of docs ?? []) {
    if (!d?.pageContent) continue;
    const id =
      d.metadata?.id != null ? String(d.metadata.id).trim() : "";
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(d);
  }
  return out;
}

/**
 * 打印一批 Document 的简要信息（调试用）：
 *   - label：阶段名称（如「Elasticsearch 检索」）
 *   - docs ：Document[]，逐条打印正文前 200 字与完整 metadata
 */
function printDocs(label, docs) {
  console.log(`\n=== ${label} (${docs?.length ?? 0} 条) ===`);
  for (let i = 0; i < (docs ?? []).length; i++) {
    const d = docs[i];
    const preview = (d.pageContent ?? "").slice(0, 200).replace(/\n/g, " ");
    console.log(`[${i}] ${preview}${d.pageContent?.length > 200 ? "…" : ""}`);
    console.log(`    metadata:`, d.metadata ?? {});
  }
}

/** 打印 LLM 生成的多角度检索问句及逐条检索列表 */
function printQueryRewrite(original, augmentation) {
  const qs = augmentation?.queries ?? [];
  const forRetrieval = retrievalQueryStrings(original, augmentation);

  console.log(`\n--- 查询扩展（LLM 生成 ${qs.length} 条检索问句）---`);
  console.log("原始 query:", original ?? "");
  for (let i = 0; i < qs.length; i++) console.log(`  [${i + 1}] ${qs[i] ?? ""}`);
  console.log(
    `\n逐条 ES + Milvus（共 ${forRetrieval.length} 条检索串，含原始问题）:`,
  );
  for (let i = 0; i < forRetrieval.length; i++) {
    console.log(`  [${i + 1}] ${forRetrieval[i] ?? ""}`);
  }
}

/**
 * 把 LLM 返回的 message.content 统一转成纯字符串：
 * 兼容三种形态——直接字符串、带 text 字段的对象数组、或空值兜底。
 */
function stringifyMessageContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((c) =>
      typeof c === "string" ? c : typeof c?.text === "string" ? c.text : "",
    )
    .join("");
}

/**
 * 把重排后的 Document[] 格式化成语义上下文文本（注入提示词用）：
 * 每条片段以 [序号] id=xxx source=xxx 开头，片段间用 --- 分隔。
 */
function formatDocsAsContext(docs) {
  return (docs ?? [])
    .map((d, i) => {
      const meta = d.metadata ?? {};
      const src = meta.source ?? "";
      const id = meta.id != null ? String(meta.id) : "";
      const head = id ? `[${i + 1}] id=${id}${src ? ` source=${src}` : ""}` : `[${i + 1}]`;
      return `${head}\n${d.pageContent ?? ""}`;
    })
    .join("\n\n---\n\n");
}

const ANSWER_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你是阅读用户「生活笔记」知识库并作答的助手。
规则：
- 只根据下方「检索片段」推断答案；片段里没有的信息不要编造。
- 若片段不足以回答，明确说明「笔记里未提到」，并可给出一句保守建议。
- 回答简洁有条理，可使用简短列表；口吻自然中文。`,
  ],
  [
    "human",
    `用户问题：{query}

检索片段：
{context}`,
  ],
]);

const NO_CONTEXT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你是阅读用户「生活笔记」知识库并作答的助手。当前没有检索到任何片段。
请用一两句话说明无法从笔记中回答，并礼貌询问用户是否换个说法或补充关键词。`,
  ],
  ["human", "用户问题：{query}"],
]);

/**
 * 组装混合检索图（LangGraph 版）。
 * 流程：query_augment → es_recall ∥ milvus_recall → merge → rerank → generate_answer
 * 说明：es_recall 和 milvus_recall 之间没有先后依赖，
 *       LangGraph 会自动并行执行这两个节点。
 */
export function compileHybridRetrievalGraph(esClient, milvus, reranker, chatModel) {
  const ES_K = 15; // ES 侧总召回条数预算（会被多条问句分摊）
  const MILVUS_K = 15; // Milvus 侧总召回条数预算

  return new StateGraph(HybridRetrievalState)
    // —— 节点① 查询扩展：LLM 把原问题改写成 3 条不同角度的检索问句 ——
    .addNode("query_augment", async (state) => ({
      queryAugmentation: await augmentQuery(chatModel, state.query ?? ""),
    }))
    // —— 节点② ES 全文检索：每条问句各搜一次，结果合并去重 ——
    .addNode("es_recall", async (state) => {
      const qs = retrievalQueryStrings(state.query, state.queryAugmentation);
      const n = Math.max(1, qs.length);
      const kEach = Math.max(2, Math.ceil(ES_K / n)); // 总预算按问句数均分，每条取 kEach 条
      const batches = await Promise.all(
        qs.map((q) =>
          esClient.search({
            index: INDEX,
            size: kEach,
            query: {
              // multi_match 多字段同时检索；^2 表示标题命中权重是正文的 2 倍
              multi_match: {
                query: q,
                fields: ["note_title^2", "note_body", "title", "content"],
                type: "best_fields", // 取多个字段里得分最高的那个作为最终分
                analyzer: "ik_smart", // 中文智能分词
              },
            },
          }),
        ),
      );
      const flat = batches.flatMap((res) =>
        (res.hits?.hits ?? []).map(docFromEsHit), // 原始 hit → LangChain Document
      );
      return { esHits: dedupeDocsById(flat) };
    })
    // —— 节点③ Milvus 向量检索：每条问句向量化后按语义相似度召回 ——
    .addNode("milvus_recall", async (state) => {
      const qs = retrievalQueryStrings(state.query, state.queryAugmentation);
      const n = Math.max(1, qs.length);
      const kEach = Math.max(2, Math.ceil(MILVUS_K / n));
      const batches = await Promise.all(
        qs.map((q) => milvus.similaritySearch(q, kEach)), // 内部会先向量化 query 再搜
      );
      const flat = batches.flat();
      return { milvusHits: dedupeDocsById(flat) };
    })
    // —— 节点④ 合并：ES + Milvus 结果拼接，按 metadata.id 去重（见上方 merge 函数） ——
    .addNode("merge", async (state) => ({
      merged: merge(state.esHits, state.milvusHits),
    }))
    // —— 节点⑤ Rerank 重排：用语义排序模型把合并结果按相关性重新排序，只留 topN ——
    .addNode("rerank", async (state) => {
      const merged = state.merged ?? [];
      if (!merged.length) return { topDocuments: [] }; // 没召回到任何文档，直接跳过
      const topDocuments = await reranker.compressDocuments(merged, state.query);
      return { topDocuments };
    })
    // —— 节点⑥ 生成回答：把重排后的片段塞进提示词，交给 LLM 作答 ——
    .addNode("generate_answer", async (state) => {
      const query = state.query ?? "";
      const docs = state.topDocuments ?? [];
      if (!docs.length) {
        // 空召回：用专门的无上下文提示词，礼貌说明无法回答
        const chain = NO_CONTEXT_PROMPT.pipe(chatModel);
        const msg = await chain.invoke({ query });
        return { answer: stringifyMessageContent(msg.content).trim() };
      }
      // 正常路径：片段格式化后作为 context 注入
      const chain = ANSWER_PROMPT.pipe(chatModel);
      const msg = await chain.invoke({
        query,
        context: formatDocsAsContext(docs),
      });
      return { answer: stringifyMessageContent(msg.content).trim() };
    })
    // —— 构图：START → 查询扩展 → 两个检索节点并行 → 合并 → 重排 → 生成 → END ——
    .addEdge(START, "query_augment")
    .addEdge("query_augment", "es_recall") // 查询扩展后，ES 检索
    .addEdge("query_augment", "milvus_recall") // 查询扩展后，Milvus 检索（两条边并行走）
    .addEdge(["es_recall", "milvus_recall"], "merge") // 两个检索都完成才进 merge（并行汇合）
    .addEdge("merge", "rerank")
    .addEdge("rerank", "generate_answer")
    .addEdge("generate_answer", END)
    .compile(); // 编译为可执行 graph
}

// ① ES 客户端：全文检索用
const esClient = new Client({ node: "http://localhost:9300" });
// ② 向量化模型：query 和文档都要用它转向量（阿里云 DashScope 兼容接口）
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-v3",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
});
// ③ Milvus 向量库（langchain 封装）：fromExistingCollection 直接复用 seed-data 建好的集合
const milvus = await Milvus.fromExistingCollection(embeddings, {
  url: "http://localhost:19530",
  collectionName: INDEX,
  textField: "doc_text", // 原始文本字段
  vectorField: "embedding", // 向量字段
});
// ④ Rerank 重排器：自定义 DashScope 排序模型，把合并结果压到 topN 条
const reranker = new DashScopeRerank({
  apiKey: process.env.OPENAI_API_KEY,
  model: "qwen3-rerank",
  topN: 3,
  baseUrl:
    "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank",
});

// ⑤ 对话模型：负责查询扩展与最终回答
const chatModel = new ChatOpenAI({
  model: process.env.LLM_MODEL_NAME ?? "qwen-turbo",
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0.2,
  configuration: {
    baseURL:
      process.env.OPENAI_BASE_URL
  },
});

/** 示例用户 query（字符串列表），可换行增减测试用例 */
const SAMPLE_QUERIES = [
  // "PO-20250409-K9 滤芯订单",   // 精确数字，考验 ES 字面匹配
  "家里无线老是断断续续的咋整啊", // 口语化表达，考验 LLM 改写 + 双路召回
  // "那个黑凉粉粉怎么冲不结块",
  // "明火炖太久汤汁又黏又涩，起锅前要怎么处理才不腻",
];

const graph = compileHybridRetrievalGraph(esClient, milvus, reranker, chatModel);

const drawable = await graph.getGraphAsync();
console.log(drawable.drawMermaid());
console.log();

for (const query of SAMPLE_QUERIES) {
  console.log(`query: ${query}`);

  const state = await graph.invoke({ query });

  printQueryRewrite(state.query, state.queryAugmentation);
  console.log("\n（原始 JSON）", JSON.stringify(state.queryAugmentation));

  printDocs("Elasticsearch 检索", state.esHits);
  printDocs("Milvus 检索", state.milvusHits);
  printDocs("重排后保留", state.topDocuments ?? []);

  console.log("\n=== 大模型生成回答 ===\n");
  console.log(state.answer ?? "");
}
