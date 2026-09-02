/**
 * rag_agent.mjs —— RAG Agent 核心模块：LangGraph 状态图 + Milvus 向量检索 + LLM 生成
 *
 * 核心思路：
 *   1. 用户问题先向量化，到 Milvus 里做语义相似度检索（Top-K 召回）
 *   2. 把召回片段拼成「上下文」注入 prompt
 *   3. 让 LLM 仅依据上下文作答，杜绝编造（幻觉控制）
 *
 * 图结构（两节点直线流程）：
 *   START → retrieve（问题 → 检索片段 context）
 *         → generate（context + question → 最终回答 answer）
 *         → END
 *
 * 前置条件：
 *   1. Milvus 已启动（docker compose up -d），且数据已入库（npm run insert）
 *   2. .env 已配置 OPENAI_API_KEY / OPENAI_BASE_URL / MILVUS_URI 等
 *
 * 导出：
 *   - ragApp：编译后的可运行图（评测脚本 run_eval.mjs 直接 invoke）
 *   - ask(question)：便捷封装，返回 { answer, context }
 */
import "dotenv/config"; // 加载 .env 到 process.env
import { Annotation, END, START, StateGraph } from "@langchain/langgraph"; // LangGraph 状态图编排
import { ChatPromptTemplate } from "@langchain/core/prompts"; // 提示词模板（system/human 消息）
import { StringOutputParser } from "@langchain/core/output_parsers"; // 把模型输出转成纯字符串
import { RunnableSequence } from "@langchain/core/runnables"; // 把「模板+模型+解析器」串成一条可调用链
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai"; // OpenAI 兼容协议的生成/嵌入模型
import { Milvus } from "@langchain/community/vectorstores/milvus"; // LangChain 的 Milvus 向量库封装

// ----------------------
// 嵌入模型（Embedding）
// ----------------------
// 作用：把「用户问题」转成向量，用于在 Milvus 里算余弦/欧式相似度。
// 模型默认 text-embedding-v3（阿里百炼），
// 必须与 milvus_insert.mjs 入库时用的模型一致，否则向量空间不兼容、检索失效。
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY, // API Key，从 .env 读取
  configuration: { baseURL: process.env.OPENAI_BASE_URL }, // 兼容 OpenAI 协议的网关地址（如百炼）
  model: process.env.EMBEDDING_MODEL ?? "text-embedding-v3", // 嵌入模型名，可覆盖
});

// ----------------------
// 生成模型（LLM）
// ----------------------
// 作用：把「检索到的上下文 + 用户问题」组织成最终回答。
// temperature=0：客服回答要「事实准确、忠于上下文」，关闭随机性让输出更稳定。
const llm = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  model: process.env.MODEL_NAME ?? "qwen-plus", // 生成模型名（评测的 Judge 也复用该值）
  temperature: 0,
});

// ----------------------
// 向量库与检索器
// ----------------------
// fromExistingCollection：直接连接已建好的集合（数据由 milvus_insert.mjs 写入），
// 不会自动建集合 —— 集合不存在时会抛 "Collection not found"。
const vectorStore = await Milvus.fromExistingCollection(embeddings, {
  collectionName: process.env.MILVUS_COLLECTION ?? "rag_docs", // 集合名，与入库脚本保持一致
  url: process.env.MILVUS_URI ?? "http://localhost:19530", // Milvus HTTP 地址
});

// asRetriever({ k: 4 })：把向量库包装成检索器，每次召回最相似的 4 个片段。
// k 越大上下文越全但噪音越多、token 成本越高；4 对客服知识文档是常用取值。
const retriever = vectorStore.asRetriever({ k: 4 });

// ----------------------
// 提示词与生成链路
// ----------------------
// system 提示词是 RAG 幻觉控制的闸门：
// 「仅根据上下文回答」+「不知道就明说」两条硬约束，压制模型自由发挥。
const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是客服助手。仅根据下面「上下文」回答；上下文没有的信息请明确说不知道，不要编造。\n\n上下文：\n{context}",
  ],
  ["human", "{question}"],
]);

// 生成链路：prompt 模板 → LLM → 纯文本解析。
// RunnableSequence 保证三个组件按序执行，invoke 时统一传入 { context, question }。
const chain = RunnableSequence.from([prompt, llm, new StringOutputParser()]);

// ----------------------
// LangGraph 状态定义
// ----------------------
// Annotation.Root 声明图节点之间共享的「黑板」字段：
//  - question：用户问题（初始入参）
//  - context：检索节点写入的片段列表（Document[]）
//  - answer：生成节点写入的最终回答
// 节点返回值中只包含要更新的字段（增量更新，未返回的字段保持不变）。
const GraphState = Annotation.Root({
  question: Annotation,
  context: Annotation,
  answer: Annotation,
});

// ----------------------
// 节点1：检索（retrieve）
// ----------------------
// 入参 state 里带着 question；把问题丢给 retriever 做向量检索，
// 返回 { context: docs } 会合并进图状态，供下一步 generate 使用。
async function retrieve(state) {
  const docs = await retriever.invoke(state.question);
  return { context: docs };
}

// ----------------------
// 节点2：生成（generate）
// ----------------------
// 先把所有片段 pageContent 用空行拼成一段上下文文本，
// 再走 chain 生成回答。返回 { answer } 写入状态，随后到达 END。
async function generate(state) {
  const contextText = state.context.map((d) => d.pageContent).join("\n\n");
  const answer = await chain.invoke({
    context: contextText,
    question: state.question,
  });
  return { answer };
}

// ----------------------
// 组装并编译工作流
// ----------------------
// StateGraph 按声明顺序注册节点与边：retrieve → generate 直线流转。
// compile() 生成可执行的图对象（ragApp），可被 cli.mjs / run_eval.mjs 反复调用。
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
 * @returns {Promise<{answer: string, context: Document[]}>} 回答与检索片段列表
 */
export async function ask(question) {
  const result = await ragApp.invoke({ question });
  return {
    answer: result.answer,
    // context 理论上一定存在（retrieve 节点已写入），加 ?? [] 兜底防御
    context: result.context ?? [],
  };
}
