/**
 * cli.mjs —— RAG 问答 CLI 入口
 *
 * 用法：
 *   node src/cli.mjs                  # 无参数：依次跑 DEFAULT_QUESTIONS 全部示例
 *   node src/cli.mjs 你的问题         # 带参数：把参数拼成一个问题单独提问
 *
 * 内部流程：
 *   1. 调用 rag_agent.mjs 导出的 ask(question) 跑一遍「检索 → 生成」RAG 图
 *   2. 打印最终回答
 *   3. 打印检索引用片段（来源文件名 + 截断预览），便于核对回答是否来自知识库
 *
 * 前置条件：Milvus 已启动且有数据（npm run insert 入库后）
 */
import "dotenv/config"; // 加载 .env 到 process.env
import { ask } from "./rag_agent.mjs"; // RAG 问答入口

/**
 * 无参数时默认提问的示例问题。
 * 覆盖退货 / 运费 / 会员 / 发票 / 保修 / 客服等常见客服场景，
 * 方便不传参直接验收整体链路。
 */
const DEFAULT_QUESTIONS = [
  "无理由退货要在几天内？",
  "满多少元包邮？",
  "金卡会员有什么折扣？",
  "电子发票多久能开好？",
  "手机保修多久？",
  "紧急问题怎么联系客服？",
];

// 命令行参数解析：有参数就把所有参数拼成一个问题；没有就用内置示例
const args = process.argv.slice(2); // 去掉 node 与脚本路径两个固定参数
const questions = args.length > 0 ? [args.join(" ")] : DEFAULT_QUESTIONS;

/**
 * 打印检索引用片段（来源文件名 + 内容预览，超长截断到 100 字符）
 * @param {Array<{pageContent: string, metadata?: {source?: string}}>} context 检索召回片段
 */
function printContext(context) {
  if (!context.length) {
    console.log("\n引用片段: （无）");
    return;
  }
  console.log("\n引用片段:");
  context.forEach((doc, i) => {
    const source = doc.metadata?.source ?? "未知"; // 来源文件名（入库时写入 metadata）
    const text = doc.pageContent.replace(/\s+/g, " ").trim(); // 压缩空白，便于单行展示
    const preview = text.length > 100 ? `${text.slice(0, 100)}…` : text; // 超长截断预览
    console.log(`  [${i + 1}] ${source}`);
    console.log(`      ${preview}`);
  });
}

// 依次提问并打印结果
for (let i = 0; i < questions.length; i++) {
  const question = questions[i];
  console.log(`\n${"=".repeat(50)}`); // 分隔线，区分多个问题
  console.log(`问题 ${i + 1}: ${question}`);

  const { answer, context } = await ask(question); // 跑 RAG 图拿回答与召回片段
  console.log(`\n答: ${answer}`);
  printContext(context);
}

// 收尾统计：跑完的问题总数
console.log(`\n${"=".repeat(50)}`);
console.log(`共 ${questions.length} 个问题`);
