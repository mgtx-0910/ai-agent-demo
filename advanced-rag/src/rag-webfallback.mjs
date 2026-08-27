/**
 * ============================================================
 * rag-webfallback.mjs —— 本地检索 + 联网回退（RAG with Web Fallback）
 * ============================================================
 * 解决「本地知识库查不到 / 查不全」的问题：先查本地 Milvus，
 * 用 LLM 评估检索结果是否足以回答；不够时自动调用博查搜索 API 联网补充，
 * 联网结果再评估一次，最后综合本地 + 网络信息生成回答。
 *
 * 图结构：
 *   START --> route
 *   route --(direct)-->  direct_answer --> END
 *   route --(retrieve)--> retrieve_local --> evaluate
 *   evaluate --(足够)-->  generate --> END
 *   evaluate --(不足)-->  web_search --> evaluate_web --> generate --> END
 *
 * 相比 multihop 的新概念：
 *   1. evaluate（评估器）：用结构化输出判断「本地检索结果是否够用」，
 *      不够时 reason 字段会说明缺什么信息 → 驱动联网回退
 *   2. 外部 HTTP API 调用：博查搜索（Bocha Web Search API），
 *      通过 fetch 直连，不依赖 LangChain 的第三方集成
 *   3. 三级「direct → 本地检索 → 联网」的递进式信息获取策略
 *
 * 依赖：.env 中需配置 BOCHA_API_KEY（博查搜索的 API Key）
 * 运行：node src/rag-webfallback.mjs
 */
import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Milvus } from "@langchain/community/vectorstores/milvus";
import { ChatPromptTemplate } from "@langchain/core/prompts";

// ===== 可调参数 =====
const COLLECTION_NAME = "ebook_collection"; // 本地 Milvus 集合名
const TOP_K = 5; // 本地检索条数
const WEB_RESULTS = 5; // 联网搜索返回结果条数

/**
 * 图状态定义：
 *   question        : 用户问题
 *   k               : 本地检索条数
 *   documents       : 本地检索命中的片段
 *   web_documents   : 联网搜索到的网页内容片段
 *   generation      : 最终回答
 *   route_name      : 路由结果（direct | retrieve），调试用
 */
const GraphState = Annotation.Root({
  question: Annotation,
  k: Annotation,
  documents: Annotation,
  web_documents: Annotation,
  generation: Annotation,
  route_name: Annotation,
});

// 生成模型
const model = new ChatOpenAI({
  temperature: 0,
  model: process.env.MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  apiKey: process.env.OPENAI_API_KEY,
});

// 嵌入模型
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-v3",
  dimensions: 1024,
});

// 全局向量库句柄
let vectorStore;

/** 路由输出结构 */
const RouteSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      description: "路由类型：direct 直接回答；retrieve 需要检索后回答",
      enum: ["direct", "retrieve"],
    },
  },
  required: ["type"],
};

/**
 * 评估输出结构：判断信息是否足够
 *   sufficient: true  → 现有信息够用
 *   sufficient: false → 信息不足，reason 说明缺什么
 *   search_queries   : 当不足时，需要联网搜索的查询词列表
 */
const EvaluateSchema = {
  type: "object",
  properties: {
    sufficient: {
      type: "boolean",
      description: "当前信息是否足以回答用户问题",
    },
    reason: {
      type: "string",
      description: "判断理由；若不足，说明缺少什么信息",
    },
    search_queries: {
      type: "array",
      items: { type: "string" },
      description: "若不足，需要联网搜索的查询词列表（为空表示无需搜索）",
    },
  },
  required: ["sufficient", "reason", "search_queries"],
};

/** 节点① 路由：判断是否需要检索（与 query-router 相同的直接/检索分流） */
const routeQuestionNode = async (state) => {
  const routePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是一个问题路由分类器。根据用户的问题复杂度，将问题分类为：
- direct: 适合直接回答的问题（常识性、概述性、不需要特定书籍细节的问题）
- retrieve: 需要检索书籍内容才能准确回答的问题（涉及具体情节、人物、细节、引文等）

只输出 JSON 对象。`,
    ],
    ["human", "问题: {question}"],
  ]);
  const route = await routePrompt.pipe(model.withStructuredOutput(RouteSchema)).invoke({
    question: state.question,
  });
  return { ...state, route_name: route.type };
};

/** 节点② 直接回答（不检索、不联网） */
const directAnswerNode = async (state) => {
  const directPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是一个专业的《天龙八部》小说助手。你可以基于你的知识回答用户的问题。

回答要求：
1. 回答要准确、简洁、友好
2. 对于你了解的内容，给出详细的回答
3. 如果不确定，可以如实说明
4. 不需要引用书籍原文，给出流畅自然的回答即可`,
    ],
    ["human", "{question}"],
  ]);
  const response = await directPrompt.pipe(model).invoke({ question: state.question });
  return { ...state, generation: response.content };
};

/** 节点③ 本地检索：从 Milvus 取相关片段 */
const retrieveLocalNode = async (state) => {
  console.log("  [本地检索] 查询 Milvus...");
  const docsWithScores = await vectorStore.similaritySearchWithScore(state.question, state.k);
  const documents = docsWithScores.map(([doc, score]) => ({
    score,
    content: doc.pageContent,
    id: doc.metadata?.id ?? "unknown",
    book_id: doc.metadata?.book_id ?? "未知",
    chapter_num: doc.metadata?.chapter_num ?? "未知",
    index: doc.metadata?.index ?? "未知",
  }));
  return { ...state, documents };
};

/** 节点④ 评估：判断本地检索结果是否足以回答（驱动联网回退的开关） */
const evaluateNode = async (state) => {
  // 把本地检索片段拼成上下文供评估器阅读
  const context = state.documents
    .map(
      (item, i) =>
        `[片段 ${i + 1}]
章节: 第 ${item.chapter_num} 章
内容: ${item.content}`,
    )
    .join("\n\n━━━━━\n\n");

  const evaluatePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是一个信息评估专家。判断以下从《天龙八部》书籍中检索到的片段，是否足以回答用户的问题。
评估标准：
1. 片段中是否包含回答问题的关键信息（人物、情节、时间、地点、事件等）
2. 片段内容是否与问题直接相关
3. 信息是否完整，能否支撑一个准确的回答

如果片段中缺少关键信息、内容不相关、或信息过于笼统无法准确回答，则判定为不足。

检索到的片段：
{context}

只输出 JSON 对象。`,
    ],
    ["human", "问题: {question}"],
  ]);

  const evaluation = await evaluatePrompt
    .pipe(model.withStructuredOutput(EvaluateSchema))
    .invoke({ question: state.question, context });

  console.log(
    `  [评估] sufficient=${evaluation.sufficient}，reason=${evaluation.reason}，搜索词=${JSON.stringify(evaluation.search_queries)}`,
  );

  return { ...state, ...evaluation };
};

/**
 * 调用博查（Bocha）联网搜索 API
 * 流程：用 search_queries 构造搜索请求 → 解析响应 → 提取 title/content/url
 * 注意：这是对第三方 HTTP API 的裸调用，不走 LangChain 工具链，
 * 用 fetch（Node 18+ 内置）实现，无需额外安装依赖。
 */
async function bochaWebSearch(searchQueries) {
  const apiKey = process.env.BOCHA_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 BOCHA_API_KEY 环境变量，请检查 .env 配置");
  }

  const results = [];
  // 每个查询词各搜一次（去重后可能是多个词）
  for (const query of searchQueries) {
    console.log(`  [联网搜索] 博查搜索: ${query}`);
    const response = await fetch("https://api.bochaai.com/v1/web-search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query, // 搜索关键词
        freshness: "noLimit", // 时间范围：不限
        summary: true, // 要求返回摘要，便于直接当上下文用
        count: WEB_RESULTS, // 返回条数
      }),
    });

    if (!response.ok) {
      console.error(`搜索 ${query} 失败: HTTP ${response.status} ${response.statusText}`);
      continue; // 单次搜索失败不中断整体流程
    }

    const data = await response.json();
    // 博查响应结构：data.webPages.value[]，每个 value 含 name/snippet/url 等
    const pages = data?.data?.webPages?.value ?? [];
    pages.forEach((page) => {
      results.push({
        title: page.name ?? "无标题",
        content: page.summary ?? page.snippet ?? "无摘要", // summary=true 时取摘要，否则取 snippet
        url: page.url ?? "",
      });
    });
  }
  return results;
}

/** 节点⑤ 联网搜索：本地评估不足时调用，结果存入 web_documents */
const webSearchNode = async (state) => {
  try {
    const webDocs = await bochaWebSearch(state.search_queries);
    return { ...state, web_documents: webDocs };
  } catch (error) {
    console.error("  [联网搜索] 出错:", error.message);
    return { ...state, web_documents: [] }; // 联网失败时置空，生成节点自行兜底
  }
};

/** 节点⑥ 联网结果评估：确认网络信息是否补足了缺口 */
const evaluateWebNode = async (state) => {
  // 把本地片段 + 网络内容合并成上下文
  const localContext = (state.documents ?? [])
    .map((item, i) => `[本地片段 ${i + 1}] 章节: 第 ${item.chapter_num} 章 内容: ${item.content}`)
    .join("\n\n");
  const webContext = (state.web_documents ?? [])
    .map(
      (item, i) =>
        `[网页片段 ${i + 1}] 标题: ${item.title}
内容: ${item.content}
来源: ${item.url}`,
    )
    .join("\n\n");

  const evaluatePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是信息评估专家。判断以下从本地书籍和联网搜索获得的信息，是否足以回答用户的问题。
评估标准：
1. 是否包含回答问题的关键信息
2. 内容是否与问题直接相关
3. 信息是否足够支撑准确回答

本地检索片段：
{local_context}

联网搜索结果：
{web_context}

只输出 JSON 对象。`,
    ],
    ["human", "问题: {question}"],
  ]);

  const evaluation = await evaluatePrompt
    .pipe(model.withStructuredOutput(EvaluateSchema))
    .invoke({
      question: state.question,
      local_context: localContext || "（本地无检索结果）",
      web_context: webContext || "（无联网结果）",
    });

  console.log(
    `  [联网评估] sufficient=${evaluation.sufficient}，reason=${evaluation.reason}，补充搜索词=${JSON.stringify(evaluation.search_queries)}`,
  );

  return { ...state, ...evaluation };
};

/** 节点⑦ 最终生成：综合本地 + 联网信息生成回答 */
const generateNode = async (state) => {
  // 分别组装本地片段与网络内容
  const localContext = (state.documents ?? [])
    .map(
      (item, i) =>
        `[本地片段 ${i + 1}]
章节: 第 ${item.chapter_num} 章
内容: ${item.content}`,
    )
    .join("\n\n━━━━━\n\n");

  const webContext = (state.web_documents ?? [])
    .map(
      (item, i) =>
        `[网页片段 ${i + 1}]
标题: ${item.title}
内容: ${item.content}
来源: ${item.url}`,
    )
    .join("\n\n━━━━━\n\n");

  const generatePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是一个专业的《天龙八部》小说助手。基于以下检索到的信息回答用户的问题。

【本地书籍检索结果】
${localContext}

【联网搜索结果】
${webContext}

回答要求：
1. 优先使用本地书籍检索结果，联网结果作为补充
2. 如果本地书籍中没有相关信息，使用联网搜索结果回答
3. 信息不足时如实告知
4. 注明信息来源：本地片段（章节）或网页（标题+链接）
5. 回答要准确、完整、有条理`,
    ],
    ["human", "问题: {question}"],
  ]);

  // 流式输出
  process.stdout.write("\n【AI 回答（流式）】\n");
  let generation = "";
  const stream = await generatePrompt.pipe(model).stream({ question: state.question });
  for await (const chunk of stream) {
    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (!text) continue;
    generation += text;
    process.stdout.write(text);
  }
  process.stdout.write("\n");

  return { ...state, generation };
};

/**
 * 路由函数（route 之后）：direct → 直接回答，否则 → 本地检索
 */
const afterRoute = (state) => (state.route_name === "direct" ? "direct_answer" : "retrieve_local");

/**
 * 路由函数（本地检索评估之后）：联网回退的开关
 *   sufficient=true  → 本地够了，直接生成
 *   sufficient=false → 本地不足，联网搜索补
 */
const afterEvaluateLocal = (state) =>
  state.sufficient ? "generate" : "web_search";

/**
 * 构图：
 *   START -> route
 *   route --(direct)-->  direct_answer --> END
 *   route --(retrieve)--> retrieve_local --> evaluate
 *   evaluate --(足够)--> generate --> END
 *   evaluate --(不足)--> web_search --> evaluate_web --> generate --> END
 * 注意：联网后的 evaluate_web 结果不再继续触发二次联网（信息已尽力收集），
 * 直接进入 generate 由模型综合处理。
 */
const graph = new StateGraph(GraphState) // 用 GraphState 声明的状态结构创建一个新的状态图
  .addNode("route", routeQuestionNode) // 注册「路由」节点：判断问题是直接回答还是需要本地检索
  .addNode("direct_answer", directAnswerNode) // 注册「直接回答」节点：简单问题不走检索，直接生成答案
  .addNode("retrieve_local", retrieveLocalNode) // 注册「本地检索」节点：从 Milvus 检索相关文档片段
  .addNode("evaluate", evaluateNode) // 注册「本地评估」节点：判断本地检索结果是否足以回答
  .addNode("web_search", webSearchNode) // 注册「联网搜索」节点：本地信息不足时调用博查搜索 API
  .addNode("evaluate_web", evaluateWebNode) // 注册「联网评估」节点：确认本地+网络信息是否已补足缺口
  .addNode("generate", generateNode) // 注册「生成」节点：综合本地片段与联网结果生成最终回答
  .addEdge(START, "route") // 入口边：流程从 START 进入 route 节点
  // 条件边：route 节点根据 afterRoute 的返回值决定走 direct_answer「直接回答」 还是 retrieve_local「本地检索」
  .addConditionalEdges("route", afterRoute, ["direct_answer", "retrieve_local"])
  .addEdge("retrieve_local", "evaluate") // 普通边：本地检索完成后进入 evaluate 做信息评估
  // 关键条件边（联网回退开关）：evaluate 根据 afterEvaluateLocal 判断
  // 信息足够 → generate 直接生成；信息不足 → web_search 联网补充
  .addConditionalEdges("evaluate", afterEvaluateLocal, ["generate", "web_search"])
  .addEdge("web_search", "evaluate_web") // 普通边：联网搜索完成后进入 evaluate_web 做二次评估
  .addEdge("evaluate_web", "generate") // 普通边：二次评估后不再回退，进入 generate 综合生成
  .addEdge("direct_answer", END) // 普通边：直接回答后结束整个图
  .addEdge("generate", END) // 普通边：生成答案后结束整个图
  .compile(); // 编译图，生成可执行的 graph 对象

async function main() {
  // 测试问题：本地可能查不到/查不全，会触发联网回退
  const question = "《天龙八部》中乔峰为什么要自杀？";
  const kArg = 5;

  // ===== 连接 Milvus =====
  console.log("连接到 Milvus...");
  vectorStore = await Milvus.fromExistingCollection(embeddings, {
    collectionName: COLLECTION_NAME,
    url: "localhost:19530",
    textField: "content",
    primaryField: "id",
    vectorField: "vector",
    indexCreateOptions: {
      metric_type: "COSINE",
      index_type: "HNSW",
      params: { M: 16, efConstruction: 200 },
      search_params: { ef: 64 },
    },
  });
  vectorStore.indexSearchParams = { metric_type: "COSINE", params: JSON.stringify({ ef: 64 }) };
  console.log("✓ 已连接\n");

  // 加载集合
  try {
    await vectorStore.client.loadCollection({ collection_name: COLLECTION_NAME });
    console.log(`✓ 集合 ${COLLECTION_NAME} 已加载\n`);
  } catch (error) {
    if (!error.message.includes("already loaded")) {
      throw error;
    }
    console.log(`✓ 集合 ${COLLECTION_NAME} 已处于加载状态\n`);
  }

  // 打印图结构（Mermaid 可视化）
  const drawable = await graph.getGraphAsync();
  const mermaid = drawable.drawMermaid({ withStyles: true });
  console.log(mermaid);

  console.log("=".repeat(80));
  console.log(`问题: ${question}`);
  console.log("=".repeat(80));

  const result = await graph.invoke({
    question,
    k: Number.isFinite(kArg) ? kArg : TOP_K,
    documents: [],
    web_documents: [],
    generation: "",
    route_name: null,
  });

  console.log("\n" + "=".repeat(80));
  console.log(`【路由决策】${result.route_name === "direct" ? "direct（直接回答）" : "retrieve（检索回答）"}`);

  // 打印本地检索详情
  if (result.documents?.length > 0) {
    console.log(`\n【本地检索到 ${result.documents.length} 个片段】`);
    result.documents.forEach((item, i) => {
      console.log(`\n[片段 ${i + 1}] 相似度: ${item.score.toFixed(4)}`);
      console.log(`书籍: ${item.book_id}`);
      console.log(`章节: 第 ${item.chapter_num} 章`);
      console.log(`内容: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`);
    });
  }

  // 打印联网检索详情
  if (result.web_documents?.length > 0) {
    console.log(`\n【联网检索到 ${result.web_documents.length} 条结果】`);
    result.web_documents.forEach((item, i) => {
      console.log(`\n[网页 ${i + 1}] ${item.title}`);
      console.log(`来源: ${item.url}`);
      console.log(`摘要: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`);
    });
  }

  console.log("\n【AI 回答】");
  console.log(result.generation);
}

main().catch((err) => {
  console.error("\n发生错误:", err.message);
  process.exit(1);
});
