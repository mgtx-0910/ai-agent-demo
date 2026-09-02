/**
 * RAG 问答 CLI 入口
 *
 * 用法：
 *   node src/cli.mjs                  # 用内置示例问题跑一轮
 *   node src/cli.mjs 你的问题         # 问单个自定义问题
 *
 * 内部调用 rag_agent.mjs 导出的 ask()，并打印回答与检索引用片段。
 */
import "dotenv/config";
import { ask } from "./rag_agent.mjs";

/** 无参数时默认提问的示例问题（覆盖退货/运费/会员/发票/保修/客服等场景） */
const DEFAULT_QUESTIONS = [
  "无理由退货要在几天内？",
  "满多少元包邮？",
  "金卡会员有什么折扣？",
  "电子发票多久能开好？",
  "手机保修多久？",
  "紧急问题怎么联系客服？",
];

const args = process.argv.slice(2);
const questions = args.length > 0 ? [args.join(" ")] : DEFAULT_QUESTIONS;

/** 打印检索引用片段（来源文件名 + 内容预览，超长截断到 100 字符） */
function printContext(context) {
  if (!context.length) {
    console.log("\n引用片段: （无）");
    return;
  }
  console.log("\n引用片段:");
  context.forEach((doc, i) => {
    const source = doc.metadata?.source ?? "未知";
    const text = doc.pageContent.replace(/\s+/g, " ").trim();
    const preview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
    console.log(`  [${i + 1}] ${source}`);
    console.log(`      ${preview}`);
  });
}

for (let i = 0; i < questions.length; i++) {
  const question = questions[i];
  console.log(`\n${"=".repeat(50)}`);
  console.log(`问题 ${i + 1}: ${question}`);

  const { answer, context } = await ask(question);
  console.log(`\n答: ${answer}`);
  printContext(context);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`共 ${questions.length} 个问题`);
