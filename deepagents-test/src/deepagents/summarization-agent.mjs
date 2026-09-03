/**
 * summarization-agent.mjs —— Summarization 中间件 Demo：超长对话自动滚动摘要
 *
 * 核心演示点：
 *   1. createSummarizationMiddleware 监控会话消息数，达到阈值(trigger)时自动把「最早的一批对话」
 *      交给模型生成摘要并落盘到 conversation_history/，同时从当前上下文里裁剪(keep)
 *   2. 摘要以文本形式继续参与后续对话：模型仍能回答"我们之前聊过什么"，但上下文窗口不再无限膨胀
 *   3. 用显式低阈值（8 条触发 / 保留 4 条）便于本 demo 短会话内就观察到"摘要被触发 + 历史文件生成"
 *      ——生产环境可省略 trigger/keep，deepagents 会按「模型 profile」自动推断，规则如下：
 *        a. 模型带 profile.maxInputTokens（例如 initChatModel("openai:gpt-4o") 这类带 provider 前缀的模型名，
 *           由 langchain 内置注册表注入 128000 等数值）→ 按上下文窗口比例走：
 *           trigger = 用满 85%（fraction 0.85）、keep = 保留最近 10%（fraction 0.1，
 *           按 token 预算从最新消息往回累加估算确定裁剪点）——窗口不同的模型，实际截断点自动跟着变；
 *        b. 模型拿不到 profile（本 demo 的 new ChatOpenAI({ model: 'qwen-plus' }) 即此情形，实测 profile 为空）
 *           → 回退固定兜底值：累计 170,000 token 才触发、摘要后只保留最近 6 条，并不会按 qwen 真实上下文截断；
 *        c. 额外兜底：token 估算偏差会被运行时校准（tokenEstimationMultiplier 按溢出观察放大 1.1 倍），
 *           若仍触发 ContextOverflowError，中间件会强制执行一次紧急摘要
 *
 * 运行方式：
 *   node src/deepagents/summarization-agent.mjs
 *
 * 产物：src/deepagents/workspace-summarization/conversation_history/ 下会新增会话摘要文件
 *
 * 前置条件：.env 已配置模型相关环境变量
 */
import "dotenv/config"; // 加载 .env 到 process.env
import fs from "node:fs"; // 文件系统：清理/重建工作区、列历史文件、回读摘要内容
import path from "node:path"; // 路径拼接
import { fileURLToPath } from "node:url"; // 把 import.meta.url 转成可用的文件路径
import { ChatOpenAI } from "@langchain/openai"; // 对话模型（OpenAI 兼容协议）
import { createAgent, HumanMessage } from "langchain"; // createAgent：组装 Agent
import { createSummarizationMiddleware, FilesystemBackend } from "deepagents"; // deepagents：摘要中间件 + 文件系统后端

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // 本脚本所在目录
const workspaceDir = path.join(__dirname, "workspace-summarization"); // 历史/摘要落盘目录
const historyPathPrefix = "/conversation_history"; // 摘要目录在虚拟根路径下的位置

// 摘要提示词模板：{conversation} 会被中间件替换成待摘要的原始对话
const summaryPrompt = `你是对话摘要助手。请用中文总结以下对话，包含：
1. 讨论的主要话题
2. 达成的关键结论或决定
3. 继续对话所需的重要上下文

保持简洁，不要罗列无关细节。

待摘要的对话：
{conversation}

摘要：`;

// 重建工作区：先清空旧摘要再新建，保证每次运行观察到的都是本轮触发结果
fs.rmSync(workspaceDir, { recursive: true, force: true });
fs.mkdirSync(workspaceDir, { recursive: true });

// 模型实例：摘要与对话共用同一模型
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
});

// 文件系统后端：把 workspace-summarization/ 映射成虚拟根路径 /
const backend = new FilesystemBackend({
  rootDir: workspaceDir,
  virtualMode: true,
});

// 组装 Agent：由 Summarization 中间件负责"到点就摘要 + 裁剪 + 落盘"
const agent = createAgent({
  model,
  tools: [],
  systemPrompt:
    "你是会话助手。记住用户提到的关键事实，中文简短回答。若看到「此前对话摘要」，请据此继续对话。",
  middleware: [
    createSummarizationMiddleware({
      model, // 中间件内部用同一模型生成摘要
      backend, // 摘要文件写入该文件系统
      historyPathPrefix, // 摘要落盘的虚拟目录
      summaryPrompt, // 自定义摘要提示词模板
      // 低阈值便于 demo 触发摘要。注意：此处若省略 trigger/keep，会走"模型 profile 自动推断"；
      // 但本 demo 的 qwen-plus 实例 profile 为空，届时实际回退到固定兜底值
      // （累计 17 万 token 才触发 / 摘要后保留 6 条），并不会按模型真实上下文截断——所以 demo 必须显式给阈值
      trigger: { type: "messages", value: 8 }, // 消息累计达到 8 条即触发一次摘要
      keep: { type: "messages", value: 4 }, // 摘要完成后上下文只保留最近 4 条消息
    }),
  ],
});

// 五轮对话：连续让模型记住 4 个事实（很快攒够 8 条消息触发摘要），最后跨摘要验证记忆
const prompts = [
  "请记住：我的宠物猫叫小橘。",
  "请记住：我住在北京。",
  "请记住：我喜欢喝拿铁。",
  "请记住：我的生日是 5 月 1 日。",
  "根据我们聊过的内容，我的猫叫什么、住哪、喜欢喝什么、生日是哪天？每项一行。",
];

// historyDir 只是本脚本"算出来"的真实磁盘目录，脚本自身从不写入，只用它来读
//（listHistoryFiles 列文件 / 收尾打印内容）。真正的写入者是 deepagents 库内部的
// Summarization 中间件——即下方 createSummarizationMiddleware(...) 返回的 wrapModelCall 中间件，
// 它挂在每次 agent.invoke 的"模型调用外层"，命中 trigger 阈值时自动执行，完整链路：
//   invoke → wrapModelCall → shouldSummarize 命中 → performSummarization → summarizeMessages()
//     ├─ offloadToBackend() ← 写盘：把被裁剪的旧消息 markdown 化后调 backend.write(path, text)；
//     │                        backend 就是本脚本传入的 FilesystemBackend(rootDir=workspaceDir,
//     │                        virtualMode=true)，虚拟路径 /conversation_history/session_x.md
//     │                        经它映射落盘到本目录（文件名 session_<uuid前8位>.md，同一会话
//     │                        多次触发会往同一文件追加"## Summarized at 时间戳"小节）
//     └─ createSummary()     ← 调模型生成摘要文本；注意摘要本身不落盘，而是被包成
//                                lc_source="summarization" 的 HumanMessage 放回消息列表，
//                                继续参与后续对话（本脚本只是"事后读盘打印"给观察用）
const historyDir = path.join(workspaceDir, historyPathPrefix.replace(/^\//, ""));

/**
 * 列出当前已有的摘要文件（不存在目录时返回空数组）
 * @returns {string[]} 摘要文件名列表
 */
function listHistoryFiles() {
  if (!fs.existsSync(historyDir)) return [];
  return fs.readdirSync(historyDir);
}

let messages = []; // 累积会话消息
let knownHistory = new Set(listHistoryFiles()); // 记录"已见过的"历史文件，用于识别新增

for (const prompt of prompts) {
  console.log("\n用户:", prompt);
  // 带完整历史 invoke：消息达到阈值时中间件会在此轮内自动摘要+裁剪+落盘
  ({ messages } = await agent.invoke(
    { messages: [...messages, new HumanMessage(prompt)] },
    { recursionLimit: 30 }
  ));

  console.log("回复:", messages.at(-1)?.content);
  console.log("当前消息数:", messages.length); // 观察裁剪效果：触发后应回落到 keep 附近

  // 检查是否有新生成的摘要文件（与上一轮相比多出来的）
  const historyFiles = listHistoryFiles();
  for (const file of historyFiles) {
    if (!knownHistory.has(file)) {
      knownHistory.add(file);
      console.log("已触发摘要，历史已写入:", `${historyPathPrefix}/${file}`);
    }
  }
}

// 收尾：打印本轮所有摘要文件内容，直观看到"模型把旧对话浓缩成了什么"
if (knownHistory.size > 0) {
  for (const file of knownHistory) {
    const filePath = path.join(historyDir, file);
    console.log(`\n--- ${historyPathPrefix}/${file} ---\n`, fs.readFileSync(filePath, "utf8"));
  }
} else {
  console.log("\n未生成 conversation_history（可能未触发摘要阈值）");
}
