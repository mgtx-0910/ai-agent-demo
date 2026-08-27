/**
 * ============================================================
 * rag-multihop.mjs —— 多跳 RAG（Multi-hop / Plan & Execute）
 * ============================================================
 * 解决「单次检索答不了」的复合问题：问题需要多步推理，每一步检索不同的信息，
 * 把各步答案汇总后综合成最终回答。典型例子：
 *   「乔峰和阿朱第一次见面是在哪里？」→ 需要先知道「他们怎么认识的」，
 *   再基于中间结果继续查下一个问题。
 *
 * 图结构（带循环）：
 *   START --> route
 *   route --(direct)-->  direct_answer --> END
 *   route --(decompose)--> decompose --> retrieve --> plan
 *   plan  --(需要继续检索)--> retrieve （循环回去，最多 MAX_HOPS 轮）
 *   plan  --(信息足够)-->  generate --> END
 *
 * 相比 query-router 的新概念：
 *   1. decompose（问题拆解）：把复合问题拆成 N 个独立的子问题
 *   2. plan（规划器）：每轮检索后让 LLM 判断「信息够了吗？」，
 *      不够就生成新的子查询继续检索（图内循环，因此需要条件边）
 *   3. mergeUnique（去重合并）：各轮检索结果合并，避免重复片段占用上下文
 *   4. 循环控制：MAX_HOPS 兜底，防止无限循环
 *
 * 运行：node src/rag-multihop.mjs
 */
import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Milvus } from "@langchain/community/vectorstores/milvus";
import { HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";

// ===== 可调参数 =====
const COLLECTION_NAME = "ebook_collection"; // Milvus 集合名
const TOP_K = 5; // 每次检索返回条数
const MAX_HOPS = 4; // 最大跳数（循环上限）：防止「规划器一直说信息不够」导致死循环

/**
 * 图状态定义：
 *   question        : 原始用户问题（贯穿全程，始终不变）
 *   k               : 每次检索的条数
 *   documents       : 各轮检索结果的合并集合（多跳累计）
 *   next_questions  : 规划器本轮生成的、待检索的子问题列表
 *   generate_answer : 是否进入最终生成（由规划器决定）
 *   final_answer    : 最终综合回答
 *   hop_count       : 已执行的检索轮数（循环计数器，与 MAX_HOPS 配合做兜底）
 *   route_name      : 路由结果（direct | decompose），调试用
 */
const GraphState = Annotation.Root({
  question: Annotation,
  k: Annotation,
  documents: Annotation,
  next_questions: Annotation,
  generate_answer: Annotation,
  final_answer: Annotation,
  hop_count: Annotation,
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

/**
 * 工具函数：合并去重文档
 * 多跳 RAG 中每一轮检索都会往 documents 里追加新片段，
 * 但同一片段可能被多次检索命中（子问题表述相近时），
 * 按 content 去重可以避免重复内容挤占上下文窗口。
 * @param {Array} current   已有的文档数组
 * @param {Array} incoming  新检索到的文档数组
 * @returns 合并且按 content 去重后的新数组
 */
function mergeUnique(current, incoming) {
  const seen = new Set(current.map((d) => d.content));
  const merged = [...current];
  for (const item of incoming) {
    if (!seen.has(item.content)) {
      seen.add(item.content);
      merged.push(item);
    }
  }
  return merged;
}

/** 路由输出结构：decompose（需拆解）还是 direct（直接回答） */
const RouteSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      description: "路由类型：decompose 需要拆解为多个子问题；direct 直接回答",
      enum: ["decompose", "direct"],
    },
  },
  required: ["type"],
};

/** 规划器输出结构：是否完成 + 本轮需要检索的子问题列表 */
const NextStepSchema = {
  type: "object",
  properties: {
    done: {
      type: "boolean",
      description: "是否已收集足够信息，可以生成最终回答",
    },
    next_questions: {
      type: "array",
      items: { type: "string" },
      description: "还需要检索的子问题列表（done 为 false 时必有内容）",
    },
  },
  required: ["done", "next_questions"],
};

/** 拆解器输出结构：从原问题拆出的一组子问题 */
const DecomposeSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: { type: "string" },
      description: "拆解出的独立子问题列表",
    },
  },
  required: ["questions"],
};

/** 节点① 路由：判断问题是否需要多跳拆解 */
const routeQuestionNode = async (state) => {
  const routePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是一个问题路由分类器。根据用户的问题判断是否需要多步检索：
- decompose: 问题复杂，需要分步骤、多角度检索才能回答（如涉及人物关系、事件因果、情节发展等）
- direct: 问题简单，一次检索或直接回答即可

只输出 JSON 对象。`,
    ],
    ["human", "问题: {question}"],
  ]);
  const route = await routePrompt.pipe(model.withStructuredOutput(RouteSchema)).invoke({
    question: state.question,
  });
  return { ...state, route_name: route.type };
};

/** 节点② 问题拆解：把复合问题拆成多个独立子问题 */
const decomposeQuestionNode = async (state) => {
  const decomposePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是问题拆解专家。将用户的问题拆解为多个独立、具体的子问题。
要求：
1. 子问题之间要独立，每个子问题可以单独检索
2. 子问题要具体、明确，便于在书中找到对应内容
3. 不需要把简单问题拆得过于琐碎
4. 每个子问题都应该用中文表述

只输出 JSON 对象。`,
    ],
    ["human", "请将以下问题拆解为子问题: {question}"],
  ]);
  const result = await decomposePrompt
    .pipe(model.withStructuredOutput(DecomposeSchema))
    .invoke({ question: state.question });
  // 把拆解出的子问题直接作为「本轮待检索问题」
  return { ...state, next_questions: result.questions };
};

/** 节点③ 检索：对 next_questions 里的每个子问题依次做向量检索 */
const retrieveNode = async (state) => {
  // 注意：这里返回的是新的 state，其中 documents 会做去重合并
  const allDocs = [...state.documents]; // 先复制已有文档

  for (const q of state.next_questions) {
    console.log(`  [检索] ${q}`);
    const docsWithScores = await vectorStore.similaritySearchWithScore(q, state.k);
    const docs = docsWithScores.map(([doc, score]) => ({
      score,
      content: doc.pageContent,
      id: doc.metadata?.id ?? "unknown",
      book_id: doc.metadata?.book_id ?? "未知",
      chapter_num: doc.metadata?.chapter_num ?? "未知",
      index: doc.metadata?.index ?? "未知",
    }));
    // 每一轮子问题的检索结果都合并进来
    allDocs.push(...docs);
  }

  return {
    ...state,
    documents: mergeUnique(state.documents, allDocs), // 整体去重（保证不重复）
    hop_count: state.hop_count + 1, // 跳数 +1，用于循环兜底
  };
};

/** 节点④ 规划器：基于已有检索结果，判断信息是否足够、下一步查什么 */
const planNextStepNode = async (state) => {
  // 汇总当前已检索到的片段（每个片段标注章节），让规划器看到现有信息全貌
  const context = state.documents
    .map(
      (item, i) =>
        `[片段 ${i + 1}] 章节: 第 ${item.chapter_num} 章 内容: ${item.content}`,
    )
    .join("\n\n");

  const planPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是信息收集规划器。基于已检索到的片段，判断是否已足够回答原始问题。
要求：
1. 仔细阅读所有片段，判断是否已覆盖回答问题的关键信息
2. 如果信息不足，列出还需要检索的具体子问题（要具体、可直接检索）
3. 如果信息已足够，done 设为 true

已检索到的片段：
{context}

只输出 JSON 对象。`,
    ],
    ["human", "原始问题: {question}"],
  ]);

  const plan = await planPrompt
    .pipe(model.withStructuredOutput(NextStepSchema))
    .invoke({ question: state.question, context });

  console.log(
    `  [规划] done=${plan.done}，下一步待检索问题=${JSON.stringify(plan.next_questions)}`,
  );

  return {
    ...state,
    next_questions: plan.done ? [] : plan.next_questions, // done 时清空待查问题
    generate_answer: plan.done, // done 决定是否进入最终生成
  };
};

/**
 * 路由函数（route 之后）：
 * route_name === "direct" → 直接回答；否则 → 拆解
 */
const afterRoute = (state) => (state.route_name === "direct" ? "direct_answer" : "decompose");

/**
 * 路由函数（plan 之后）：多跳循环的关键
 * 满足任一条件就结束检索、进入生成：
 *   1. 规划器认为信息足够（generate_answer === true）
 *   2. 跳数已达上限（hop_count >= MAX_HOPS），兜底防死循环
 * 否则回到 retrieve 继续检索下一轮。
 */
const afterPlan = (state) => {
  if (state.generate_answer || state.hop_count >= MAX_HOPS) {
    console.log(
      state.hop_count >= MAX_HOPS
        ? `  [循环上限] 已达 ${MAX_HOPS} 跳，强制进入生成阶段`
        : "  [规划完成] 信息已足够，进入生成阶段",
    );
    return "generate";
  }
  console.log(`  [继续检索] 第 ${state.hop_count + 1} 轮`);
  return "retrieve";
};

/** 节点⑤ 直接回答（简单问题路径，不检索） */
const directAnswerNode = async (state) => {
  const directPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `你是一个专业的《天龙八部》小说助手。你可以基于你的知识回答用户的问题。

回答要求：
1. 回答要准确、简洁、友好
2. 对于你了解的内容，给出详细的回答
3. 如果不确定，可以如实说明`,
    ],
    ["human", "{question}"],
  ]);
  const response = await directPrompt.pipe(model).invoke({ question: state.question });
  return { ...state, final_answer: response.content };
};

/** 节点⑥ 最终生成：把多轮检索到的所有片段汇总，综合成完整回答 */
const generateNode = async (state) => {
  // 把全部片段按「章节 → 内容」组织成结构化上下文
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
      `你是一个专业的《天龙八部》小说助手。基于以下从书中检索到的片段，综合回答用户的问题。

检索到的片段：
{context}

要求：
1. 综合多个片段的信息，给出完整、连贯、准确的回答
2. 可以按时间顺序、因果关系等组织回答结构
3. 如果片段信息有冲突，说明并给出最合理的解释
4. 如果信息仍然不足，如实告知
5. 引用片段中的具体情节来支撑回答`,
    ],
    ["human", "问题: {question}"],
  ]);

  // 流式输出
  process.stdout.write("\n【AI 回答（流式）】\n");
  let finalAnswer = "";
  const stream = await generatePrompt.pipe(model).stream({
    context,
    question: state.question,
  });
  for await (const chunk of stream) {
    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (!text) continue;
    finalAnswer += text;
    process.stdout.write(text);
  }
  process.stdout.write("\n");

  return { ...state, final_answer: finalAnswer };
};

/**
 * 构图：
 *   START -> route
 *   route --(direct)-->  direct_answer --> END
 *   route --(decompose)--> decompose --> retrieve --> plan
 *   plan  --(继续)--> retrieve      ← 循环回到检索
 *   plan  --(足够/超限)--> generate --> END
 */
const graph = new StateGraph(GraphState)  // 用 GraphState 声明的状态结构创建一个新的状态图
  .addNode("route", routeQuestionNode)  // 注册「路由」节点：判断问题是直接回答还是需要拆分
  .addNode("decompose", decomposeQuestionNode)  // 注册「分解」节点：把复合问题拆成多个子问题
  .addNode("retrieve", retrieveNode)  // 注册「检索」节点：从 Milvus 检索相关文档片段
  .addNode("plan", planNextStepNode)  // 注册「规划」节点：判断当前信息是否足够，决定下一步
  .addNode("direct_answer", directAnswerNode)  // 注册「直接回答」节点：简单问题不走检索，直接生成答案
  .addNode("generate", generateNode)  // 注册「生成」节点：基于检索到的上下文生成最终答案
  .addEdge(START, "route")  // 入口边：流程从 START 进入 route 节点
  // 条件边：route 节点根据 afterRoute 决定走 direct_answer「直接回答」 还是 decompose「分解」
  .addConditionalEdges("route", afterRoute, ["direct_answer", "decompose"])
  .addEdge("decompose", "retrieve") // 普通边：分解完子问题后进入 retrieve 检索
  .addEdge("retrieve", "plan")  // 普通边：检索完文档后进入 plan 做决策
  // 关键条件边：plan 节点根据 afterPlan 决定循环回 retrieve 继续检索，还是进入 generate 生成答案
  .addConditionalEdges("plan", afterPlan, ["retrieve", "generate"])
  .addEdge("direct_answer", END)   // 普通边：直接回答后结束整个图
  .addEdge("generate", END)  // 普通边：生成答案后结束整个图
  .compile(); // 编译图，生成可执行的 graph 对象

async function main() {
  // 复合问题示例：需要多轮检索才能完整回答
  const question = "乔峰为什么会离开丐帮？他离开丐帮后发生了什么？";
  // kArg：本次运行每次检索返回的文档条数（top-k）
  // 多跳场景每跳取 kArg 条，最多累计 kArg × MAX_HOPS 个片段进 documents
  // 如果以后把 kArg 改成从命令行读参数、没传或传了非法值（比如 kArg = undefined），
  // Number.isFinite 判断失败，就自动退回常量 TOP_K = 5，保证图不会因为 k 变成 NaN/undefined 而检索出错。
  const kArg = 3;

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

  // 运行图
  const result = await graph.invoke({
    question,
    // k：把检索条数写进 state，retrieve 节点用它调 similaritySearchWithScore(q, k)
    // 兜底：kArg 不是数字（如未传参/传 NaN）就退回常量 TOP_K(5)
    k: Number.isFinite(kArg) ? kArg : TOP_K,
    documents: [],
    next_questions: [],
    generate_answer: false,
    final_answer: "",
    hop_count: 0,
    route_name: null,
  });

  console.log("\n" + "=".repeat(80));
  console.log(`【路由决策】${result.route_name === "direct" ? "direct（直接回答）" : "decompose（多跳拆解）"}`);
  console.log(`【实际检索轮数】${result.hop_count} 轮`);

  // 打印最终收集到的所有片段
  console.log(`\n【多轮检索共收集 ${result.documents.length} 个片段】`);
  result.documents.forEach((item, i) => {
    console.log(`\n[片段 ${i + 1}] 相似度: ${item.score.toFixed(4)}`);
    console.log(`书籍: ${item.book_id}`);
    console.log(`章节: 第 ${item.chapter_num} 章`);
    console.log(`内容: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`);
  });

  console.log("\n【AI 回答】");
  console.log(result.final_answer);
}

main().catch((err) => {
  console.error("\n发生错误:", err.message);
  process.exit(1);
});
