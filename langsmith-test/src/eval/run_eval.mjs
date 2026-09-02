/**
 * RAG 评测入口：dataset（问题+标准答案） + evaluate
 */
import "dotenv/config";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { ask } from "../rag_agent.mjs";
import { ragEvaluators } from "./evaluators.mjs";

/** 数据集名称（与 build_dataset.mjs 保持一致） */
const DATASET_NAME = "rag-eval-v1";
/** LangSmith 客户端：上报评估结果与追踪 */
const client = new Client({ apiKey: process.env.LANGCHAIN_API_KEY });

/** 被评测的 RAG Agent：内部走 rag_agent.mjs 的 ask()，把片段纯文本化后交给评测器 */
async function runRagAgent(inputs) {
  const { answer, context } = await ask(inputs.question);
  return {
    answer,
    context: context.map((d) => d.pageContent),
  };
}

async function main() {
  const result = await evaluate(runRagAgent, {
    data: DATASET_NAME,
    evaluators: ragEvaluators,
    client,
    experimentPrefix: `rag-openevals-${process.env.MODEL_NAME ?? "qwen"}`,
    maxConcurrency: 2,
  });

  // 等待全部样例跑完
  for await (const _row of result) {
    /* drain */
  }

  const project = process.env.LANGCHAIN_PROJECT ?? "default";
  console.log("✅ 评测完成");
  console.log("实验名:", result.experimentName);
  console.log(
    "指标: rag_groundedness | rag_helpfulness | rag_retrieval_relevance",
  );
  console.log(
    `报告: https://smith.langchain.com/o/default/projects/p/${encodeURIComponent(project)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
