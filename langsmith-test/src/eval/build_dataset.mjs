/**
 * build_dataset.mjs —— 构建 LangSmith 评测数据集
 *
 * 作用：把内置的「问题 + 标准答案」问答对写入 LangSmith Dataset（rag-eval-v1），
 *      供 run_eval.mjs 的 evaluate() 读取并逐条评测 RAG Agent。
 *
 * 行为：
 *   - 数据集不存在则创建（含描述），已存在则复用（不重复建，防止误删历史）
 *   - 每次运行都会追加写入 EXAMPLES 中的样例（createExamples 是追加语义）
 *   - 样例结构：inputs.question = 输入问题，outputs.answer = 标准答案
 *     （评测器会把 Agent 的 answer 与标准答案/检索片段对比打分）
 *
 * 运行：npm run eval:dataset  （或 node src/eval/build_dataset.mjs）
 */
import "dotenv/config"; // 加载 .env 到 process.env（LANGCHAIN_API_KEY 从这里来）
import { Client } from "langsmith"; // LangSmith 官方 SDK：数据集与追踪上报

/** LangSmith 数据集名称（评测运行时 run_eval.mjs 需保持一致） */
const DATASET_NAME = "rag-eval-v1";

/**
 * 评测样例集：12 条覆盖售后/物流/支付/会员/发票/保修/客服等场景。
 * 每条样例 = 输入问题（inputs）+ 期望答案（outputs），
 * outputs.answer 用于评测器做「标准答案对比」类判断。
 */
const EXAMPLES = [
  {
    inputs: { question: "无理由退货要在几天内申请？" },
    outputs: { answer: "自签收之日起 7 天内支持无理由退货。" },
  },
  {
    inputs: { question: "质量问题换货期限是多久？" },
    outputs: { answer: "15 天内出现质量问题可免费换货。" },
  },
  {
    inputs: { question: "无理由退货运费谁承担？" },
    outputs: { answer: "无理由退货由买家承担退货运费。" },
  },
  {
    inputs: { question: "客服工作时间是什么？" },
    outputs: { answer: "周一至周五 9:00-18:00，周六 10:00-17:00，法定节假日顺延。" },
  },
  {
    inputs: { question: "满多少元包邮？" },
    outputs: { answer: "满 99 元包邮（部分大件/冷链除外）。" },
  },
  {
    inputs: { question: "现货商品多久发货？" },
    outputs: { answer: "付款后 24 小时内发货，大促期间 48 小时内。" },
  },
  {
    inputs: { question: "支持哪些支付方式？" },
    outputs: {
      answer: "支持微信支付、支付宝、银联云闪付、花呗/信用卡分期（满 500 元可选 3/6/12 期）。",
    },
  },
  {
    inputs: { question: "价保是多久？" },
    outputs: { answer: "下单后 7 天内同款降价可申请差价退还。" },
  },
  {
    inputs: { question: "金卡会员有什么折扣？" },
    outputs: { answer: "金卡享 95 折，并有专属客服和每月满 200 减 30 券。" },
  },
  {
    inputs: { question: "积分多少可以抵 1 元？" },
    outputs: { answer: "100 积分可抵 1 元，单笔最多抵扣实付金额的 30%。" },
  },
  {
    inputs: { question: "手机保修多久？" },
    outputs: { answer: "手机、平板、耳机全国联保 1 年。" },
  },
  {
    inputs: { question: "紧急问题怎么联系？" },
    outputs: { answer: "可拨打 400-800-1234 转 2，接通后报订单号。" },
  },
];

/**
 * 主流程：读取/创建数据集 → 批量写入样例
 *
 * 实现要点：
 *  - readDataset 找不到数据集会抛错，用 try/catch 判断「存在 → 复用 / 不存在 → 创建」
 *  - createExamples 返回创建的样例数组，长度即成功条数
 */
async function main() {
  const client = new Client({ apiKey: process.env.LANGCHAIN_API_KEY });

  let dataset;
  try {
    // 优先读取已存在的数据集（复用，保留历史评测样例）
    dataset = await client.readDataset({ datasetName: DATASET_NAME });
    console.log(`数据集已存在: ${DATASET_NAME}`);
  } catch {
    // 首次运行：创建数据集并附上用途描述
    dataset = await client.createDataset(DATASET_NAME, {
      description: "RAG Agent 回归评估集",
    });
    console.log(`已创建数据集: ${DATASET_NAME}`);
  }

  // 追加写入样例（dataset_id 关联到目标数据集）
  const created = await client.createExamples(
    EXAMPLES.map((e) => ({
      dataset_id: dataset.id,
      inputs: e.inputs,
      outputs: e.outputs,
    })),
  );

  console.log(`已创建 ${created.length} 条样例`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
