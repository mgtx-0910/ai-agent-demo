/**
 * ============================================================
 * rag-query-router.mjs —— 查询路由器（Query Router）
 * ============================================================
 * 在朴素 RAG 基础上引入「路由决策」：先让 LLM 判断问题的复杂度，
 * 简单问题（常识/寒暄/概述类）直接回答，不走向量检索，省时省钱；
 * 复杂问题（涉及具体情节细节）才走「检索 → 生成」的完整 RAG 链路。
 *
 * 图结构：
 *   START --> route
 *   route --(direct)-->  direct_answer --> END
 *   route --(retrieve)--> retrieve --> rag_generate --> END
 *
 * 相比 naive-rag 的新概念：
 *   1. addConditionalEdges —— 条件边，用函数返回值在多个候选节点中选择下一个
 *   2. ChatPromptTemplate + withStructuredOutput —— 用结构化输出让模型返回固定 JSON
 *   3. 手工拼接消息数组 —— 在 system 提示后插入历史消息，支持多轮对话
 *      （注意：@langchain/core v1 的 ChatPromptTemplate 已移除 append 方法，
 *        所以多轮历史直接在节点里拼 BaseMessage 数组，更直观可靠）
 *
 * 运行：node src/rag-query-router.mjs
 */
import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Milvus } from "@langchain/community/vectorstores/milvus";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";

// ===== 可调参数 =====
const COLLECTION_NAME = "ebook_collection"; // Milvus 集合名（《天龙八部》分章切块）
const TOP_K = 5; // 检索条数

/**
 * 图状态定义：
 *   question    : 用户问题
 *   k           : 检索条数
 *   documents   : 检索命中的片段
 *   generation  : 生成结果
 *   message_history : 多轮对话历史（HumanMessage/AIMessage 数组）
 *   route_name  : 路由结果（direct | retrieve），方便调试时查看走了哪条路
 */
const GraphState = Annotation.Root({
  question: Annotation,
  k: Annotation,
  documents: Annotation,
  generation: Annotation,
  message_history: Annotation,
  route_name: Annotation,
});

// 生成模型（temperature=0，RAG 场景追求确定性）
const model = new ChatOpenAI({
  temperature: 0,
  model: process.env.MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  apiKey: process.env.OPENAI_API_KEY,
});

// 嵌入模型（维度必须与 Milvus 建集合时一致）
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-v3",
  dimensions: 1024,
});

// 全局向量库句柄，main() 中连接后赋值
let vectorStore;

/**
 * JSON Schema 描述路由输出结构：
 * withStructuredOutput 会让模型严格按此结构返回 JSON，
 * 这里只需 { type: "direct" | "retrieve" } 一个字段。
 */
const RouteSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      description: "路由类型：direct 直接回答（简单问题）；retrieve 检索回答（复杂问题）",
      enum: ["direct", "retrieve"],
    },
  },
  required: ["type"],
};

/**
 * 节点① 路由判断：用 LLM 判断问题复杂度，选择 direct 或 retrieve
 * 实现方式：
 *   - 手工构造 BaseMessage 数组：SystemMessage + 历史消息 + HumanMessage
 *     （@langchain/core v1 的 ChatPromptTemplate 已无 append 方法，
 *       直接拼消息数组最直观，且天然支持多轮上下文）
 *   - 有历史时插入在 system 与当前问题之间，便于模型参考前文
 *   - withStructuredOutput 让模型输出符合 RouteSchema 的 JSON
 */
const routeQuestionNode = async (state) => {
  const messages = [
    new SystemMessage(
      `你是一个问题路由分类器。根据用户的问题复杂度，将问题分类为：
- direct: 适合直接回答的问题（常识性、概述性、不需要特定书籍细节的问题）
- retrieve: 需要检索书籍内容才能准确回答的问题（涉及具体情节、人物、细节、引文等）

只输出 JSON 对象，不要输出其他内容。`,
    ),
    // 多轮历史插在 system 与当前问题之间
    ...(state.message_history ?? []),
    new HumanMessage(
      `判断以下问题应使用 direct 还是 retrieve 路由：

问题: ${state.question}

请输出 JSON 结果。`,
    ),
  ];

  const route = await model.withStructuredOutput(RouteSchema).invoke(messages);
  return { ...state, route_name: route.type };
};

/**
 * 节点② 直接回答：不检索，模型基于自身知识回答（带历史上下文）
 * 同样手工拼消息数组：system + 历史 + 当前问题
 */
const directAnswerNode = async (state) => {
  const messages = [
    new SystemMessage(
      `你是一个专业的《天龙八部》小说助手。你可以基于你的知识回答用户的问题。

回答要求：
1. 回答要准确、简洁、友好
2. 对于你了解的内容，给出详细的回答
3. 如果不确定，可以如实说明
4. 不需要引用书籍原文，给出流畅自然的回答即可`,
    ),
    ...(state.message_history ?? []),
    new HumanMessage(state.question),
  ];

  const response = await model.invoke(messages);
  return { ...state, generation: response.content };
};

/** 节点③ 向量检索：把问题嵌入后去 Milvus 找最相似的片段 */
const retrieveNode = async (state) => {
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

/** 节点④ 基于检索结果生成回答（流式输出） */
const ragGenerateNode = async (state) => {
  // 把检索片段拼成带编号、章节信息的上下文
  const context = state.documents
    .map(
      (item, i) =>
        `[片段 ${i + 1}]
章节: 第 ${item.chapter_num} 章
内容: ${item.content}`,
    )
    .join("\n\n━━━━━\n\n");

  const generatePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是一个专业的《天龙八部》小说助手。基于小说内容回答问题，用准确、详细的语言。

请根据以下《天龙八部》小说片段内容回答问题：
{context}

回答要求：
1. 如果片段中有相关信息，请结合小说内容给出详细、准确的回答
2. 可以综合多个片段的内容，提供完整的答案
3. 如果片段中没有相关信息，请如实告知用户
4. 回答要准确，符合小说的情节和人物设定
5. 可以引用原文内容来支持你的回答`,
    ],
    ["human", "{question}"],
  ]);

  const generateChain = generatePrompt.pipe(model);

  // 流式输出
  process.stdout.write("\n【AI 回答（流式）】\n");
  let generation = "";
  const stream = await generateChain.stream({ context, question: state.question });
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
 * 条件边路由函数：根据 route_name 决定下一个节点
 * 返回值必须是 addConditionalEdges 第三个参数数组里的某个节点名
 * （或 END 哨兵）
 */
const decideNext = (state) => {
  if (state.route_name === "direct") {
    return "direct_answer"; // 简单问题 → 直接回答
  }
  return "retrieve"; // 复杂问题 → 先检索
};

/**
 * 构图：
 *   START -> route
 *   route --(direct)-->  direct_answer --> END
 *   route --(retrieve)--> retrieve --> rag_generate --> END
 * 注意 addConditionalEdges(起点, 路由函数, [候选节点列表])，
 * 候选列表里的名字就是路由函数可以返回的所有可能值。
 */
const graph = new StateGraph(GraphState)
  .addNode("route", routeQuestionNode)
  .addNode("direct_answer", directAnswerNode)
  .addNode("retrieve", retrieveNode)
  .addNode("rag_generate", ragGenerateNode)
  .addEdge(START, "route")
  .addConditionalEdges("route", decideNext, ["direct_answer", "retrieve"])
  .addEdge("direct_answer", END)
  .addEdge("retrieve", "rag_generate")
  .addEdge("rag_generate", END)
  .compile();

async function main() {
  // 预先设定两条测试问题：一条走 direct，一条走 retrieve
  const questions = [
    {
      text: "什么是《天龙八部》？",
      k: 5, // 概述性问题 → 走 direct
    },
    {
      text: "阿朱的结局是什么？",
      k: 5, // 具体情节 → 走 retrieve
    },
  ];

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

  // ===== 模拟多轮对话：每轮把上一轮消息追加进 message_history =====
  let history = [];

  for (const q of questions) {
    console.log("=".repeat(80));
    console.log(`问题: ${q.text}`);
    console.log("=".repeat(80));

    const result = await graph.invoke({
      question: q.text,
      k: q.k,
      documents: [],
      generation: "",
      message_history: history,
      route_name: null,
    });

    // 打印路由决策与检索详情
    console.log(`\n【路由决策】${result.route_name === "direct" ? "direct（直接回答）" : "retrieve（检索回答）"}`);
    if (result.documents?.length > 0) {
      console.log("\n【检索相关内容】");
      result.documents.forEach((item, i) => {
        console.log(`\n[片段 ${i + 1}] 相似度: ${item.score.toFixed(4)}`);
        console.log(`书籍: ${item.book_id}`);
        console.log(`章节: 第 ${item.chapter_num} 章`);
        console.log(
          `内容: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`,
        );
      });
    }

    console.log("\n【AI 回答】");
    console.log(result.generation);

    // 更新历史：用户问 + 模型答，作为下一轮的上下文（必须是 BaseMessage 实例）
    history.push(new HumanMessage(q.text));
    history.push(new AIMessage(result.generation));
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

main().catch((err) => {
  console.error("\n发生错误:", err.message);
  process.exit(1); // 出错时以非 0 状态退出，便于脚本监控
});
