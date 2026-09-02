/**
 * evaluators.mjs —— OpenEvals 内置 RAG 指标评测器
 *
 * 三个指标（均为 LLM-as-Judge，continuous 连续评分）：
 *   - rag_groundedness        忠实度：回答是否被检索上下文支撑（有无幻觉）
 *   - rag_helpfulness         有用性：是否切题、答非所问
 *   - rag_retrieval_relevance 检索相关性：召回片段与问题是否相关
 *
 * 原理：OpenEvals 提供官方 RAG 评测 prompt（RAG_*_PROMPT），
 *       createLLMAsJudge 把 prompt + 评判模型打包成一个「打分函数」。
 *       连续评分（continuous: true）返回 0~1 之间的分数，比二分类更敏感。
 *
 * 评判模型默认 qwen-plus（走 OPENAI_BASE_URL 兼容协议），
 * 与生成模型共用 MODEL_NAME；如需更严苛评测，可单独换更强的模型。
 */
import {
  createLLMAsJudge, // 用 prompt + LLM 构造一个可调用的评分器
  RAG_GROUNDEDNESS_PROMPT, // OpenEvals 官方「忠实度」评判模板
  RAG_HELPFULNESS_PROMPT, // OpenEvals 官方「有用性」评判模板
  RAG_RETRIEVAL_RELEVANCE_PROMPT, // OpenEvals 官方「检索相关性」评判模板
} from "openevals";
import { ChatOpenAI } from "@langchain/openai"; // 兼容 OpenAI 协议的对话模型

// ----------------------
// 评判模型（Judge）
// ----------------------
// 作为「裁判」给 Agent 的回答打分。temperature=0 保证评分稳定、可复现；
// 不配 SYSTEM 提示词，评分倾向完全由 OpenEvals 的官方 prompt 决定。
const judge = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  model: process.env.MODEL_NAME ?? "qwen-plus",
  temperature: 0,
});

// RAG_GROUNDEDNESS_PROMPT —— 忠实度：答案是否被检索上下文支撑，有无幻觉
// 输入：outputs.answer（Agent 回答）+ context.documents（召回片段）
// 输出：0~1 连续分，回答越「言之有据」分越高
const ragGroundednessJudge = createLLMAsJudge({
  prompt: RAG_GROUNDEDNESS_PROMPT,
  feedbackKey: "rag_groundedness", // 在 LangSmith 中展示的指标名
  judge,
  continuous: true, // 连续打分而非 0/1
});

// RAG_HELPFULNESS_PROMPT —— 回答有用性：是否切题、是否答非所问
// 输入：inputs.question（原问题）+ outputs.answer
const ragHelpfulnessJudge = createLLMAsJudge({
  prompt: RAG_HELPFULNESS_PROMPT,
  feedbackKey: "rag_helpfulness",
  judge,
  continuous: true,
});

// RAG_RETRIEVAL_RELEVANCE_PROMPT —— 检索相关性：召回片段与问题是否相关
// 输入：inputs.question（原问题）+ context.documents（召回片段）
// 该指标独立于回答质量，专门衡量「检索这一步」做得好不好
const ragRetrievalRelevanceJudge = createLLMAsJudge({
  prompt: RAG_RETRIEVAL_RELEVANCE_PROMPT,
  feedbackKey: "rag_retrieval_relevance",
  judge,
  continuous: true,
});

/**
 * 忠实度评测：把 RAG 回答与检索片段交给 Judge，判断是否存在幻觉
 * @param {{outputs: {answer: string, context: string[]}}} 参数集（LangSmith evaluate 传入）
 * @returns {Promise<{key: string, score: number, comment?: string}>} 评测结果
 */
export async function ragGroundednessEvaluator({ outputs }) {
  return ragGroundednessJudge({
    // OpenEvals 约定：检索片段放在 context.documents 字段
    context: { documents: outputs.context },
    outputs: { answer: outputs.answer },
  });
}

/**
 * 有用性评测：判断回答是否切题、满足用户需求
 * @param {{inputs: {question: string}, outputs: {answer: string}}} 参数集
 */
export async function ragHelpfulnessEvaluator({ inputs, outputs }) {
  return ragHelpfulnessJudge({ inputs, outputs: { answer: outputs.answer } });
}

/**
 * 检索相关性评测：判断召回片段与问题是否相关
 * @param {{inputs: {question: string}, outputs: {context: string[]}}} 参数集
 */
export async function ragRetrievalRelevanceEvaluator({ inputs, outputs }) {
  return ragRetrievalRelevanceJudge({
    inputs,
    context: { documents: outputs.context },
  });
}

/** 三个评测器的汇总数组，供 run_eval.mjs 一次性注册进 evaluate() */
export const ragEvaluators = [
  ragGroundednessEvaluator,
  ragHelpfulnessEvaluator,
  ragRetrievalRelevanceEvaluator,
];
