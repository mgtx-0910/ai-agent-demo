/**
 * RAG Agent 核心模块：LangGraph 状态图 + Milvus 检索 + LLM 生成
 *
 * 图结构（两节点直线流程）：
 *   START → retrieve（从 Milvus 召回 Top-4 片段）→ generate（拼上下文让 LLM 作答）→ END
 *
 * 导出：
 *   - ragApp：编译后的可运行图（供评测/调试直接 invoke）
 *   - ask(question)：便捷封装，返回 { answer, context }
 */
import "dotenv/config";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Milvus } from "@langchain/community/vectorstores/milvus";

/** 嵌入模型实例（用于把问题向量化后到 Milvus 检索） */
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  model: process.env.EMBEDDING_MODEL ?? "text-embedding-v3",
});

/** 生成模型实例（temperature=0 保证回答稳定、忠于上下文） */
const llm = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  model: process.env.MODEL_NAME ?? "qwen-plus",
  temperature: 0,
});

/** 连接已存在的 Milvus 集合（数据由 milvus_insert.mjs 写入） */
const vectorStore = await Milvus.fromExistingCollection(embeddings, {
  collectionName: process.env.MILVUS_COLLECTION ?? "rag_docs",
  url: process.env.MILVUS_URI ?? "http://localhost:19530",
});

/** 检索器：每次召回最相似的 4 个片段 */
const retriever = vectorStore.asRetriever({ k: 4 });

/** 系统提示词：仅依据上下文作答，禁止编造上下文之外的信息 */
const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是客服助手。仅根据下面「上下文」回答；上下文没有的信息请明确说不知道，不要编造。\n\n上下文：\n{context}",
  ],
  ["human", "{question}"],
]);

/** 生成链路：提示词模板 → LLM → 文本输出解析 */
const chain = RunnableSequence.from([prompt, llm, new StringOutputParser()]);

/** 图状态：question（用户问题）/ context（检索片段）/ answer（最终回答） */
const GraphState = Annotation.Root({
  question: Annotation,
  context: Annotation,
  answer: Annotation,
});

/** 检索节点：用问题召回 Milvus 中 Top-K 片段写入 context */
async function retrieve(state) {
  const docs = await retriever.invoke(state.question);
  return { context: docs };
}

/** 生成节点：把片段拼接为上下文，调用 LLM 生成最终回答 */
async function generate(state) {
  const contextText = state.context.map((d) => d.pageContent).join("\n\n");
  const answer = await chain.invoke({
    context: contextText,
    question: state.question,
  });
  return { answer };
}

/** 编译 LangGraph 工作流：retrieve → generate 直线流程 */
const workflow = new StateGraph(GraphState)
  .addNode("retrieve", retrieve)
  .addNode("generate", generate)
  .addEdge(START, "retrieve")
  .addEdge("retrieve", "generate")
  .addEdge("generate", END);

/** 编译后的 RAG 图（评测脚本 run_eval.mjs 也会用到） */
export const ragApp = workflow.compile();

/**
 * 问答入口：把问题跑一遍 RAG 图
 * @param {string} question 用户问题
 * @returns {Promise<{answer: string, context: Document[]}>} 回答与检索片段
 */
export async function ask(question) {
  const result = await ragApp.invoke({ question });
  return {
    answer: result.answer,
    context: result.context ?? [],
  };
}
