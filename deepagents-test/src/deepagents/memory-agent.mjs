/**
 * memory-agent.mjs —— Memory 中间件 Demo：把「项目记忆」和「用户偏好」分文件持久化
 *
 * 核心演示点：
 *   1. 用 FilesystemBackend 把 workspace-memory/ 暴露为虚拟根路径 /
 *   2. createMemoryMiddleware 在每轮请求前，把指定文件内容作为 <agent_memory> 上下文注入 system prompt，
 *      让模型"记得"文件里的长期事实
 *   3. 持久化的关键是**文件写入**：提示词约束模型在收到"请记住…"时主动 edit_file，
 *      并按内容类型写入对应文件（项目事实 → AGENTS.md；个人偏好 → memory/preferences.md），
 *      实现"记忆写入靠模型、记忆读取靠中间件注入"的闭环
 *
 * 记忆文件说明：
 *   - /AGENTS.md              项目级记忆：项目概览、技术栈、仓库约定等
 *   - /memory/preferences.md  用户级记忆：语言偏好、包管理器、回答风格等
 *
 * 运行方式：
 *   node src/deepagents/memory-agent.mjs
 *   （脚本会复用/更新 workspace-memory/ 下的记忆文件，重复运行可看到记忆持续累积）
 *
 * 前置条件：.env 已配置模型相关环境变量
 */
import "dotenv/config"; // 加载 .env 到 process.env
import fs from "node:fs"; // 文件系统：最后回读记忆文件展示写入结果
import path from "node:path"; // 路径拼接
import { fileURLToPath } from "node:url"; // 把 import.meta.url 转成可用的文件路径
import { ChatOpenAI } from "@langchain/openai"; // 对话模型（OpenAI 兼容协议）
import { createAgent, HumanMessage } from "langchain"; // createAgent：组装 Agent
import {
  createFilesystemMiddleware,
  createMemoryMiddleware,
  FilesystemBackend,
} from "deepagents"; // deepagents：文件系统 + 记忆两个中间件

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // 本脚本所在目录
const workspaceDir = path.join(__dirname, "workspace-memory"); // 记忆文件的真实落盘目录
const projectMemoryPath = "/AGENTS.md"; // 项目级记忆的虚拟路径
const preferencesMemoryPath = "/memory/preferences.md"; // 用户偏好记忆的虚拟路径

// 模型实例：temperature=0 保证记忆写入的文件内容稳定可控
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
});

// 文件系统后端：把 workspace-memory/ 映射成虚拟根路径 /，模型只能看到这个目录
const backend = new FilesystemBackend({
  rootDir: workspaceDir,
  virtualMode: true,
});

// 组装 Agent：
//  - createFilesystemMiddleware 提供 ls / read_file / write_file / edit_file（记忆靠它落盘）
//  - createMemoryMiddleware 把两个记忆文件注入 <agent_memory>，并声明哪些文件算"记忆来源"
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: [
    "你是项目助手。工作区根路径为 /，可用 ls、read_file、write_file、edit_file。",
    "根据 <agent_memory> 回答；用户要求记住时，必须立刻 edit_file，且按类型写入对应文件：",
    `- ${projectMemoryPath}：项目说明、技术栈、架构、仓库约定等`,
    `- ${preferencesMemoryPath}：用户个人偏好（语言、包管理器、回答风格等）`,
    "不要混写：项目事实不要写入 preferences，个人偏好不要写入 AGENTS.md。",
  ].join("\n"),
  middleware: [
    createFilesystemMiddleware({ backend }),
    createMemoryMiddleware({
      backend,
      sources: [projectMemoryPath, preferencesMemoryPath], // 指定哪些文件作为长期记忆读取
    }),
  ],
});

// 四轮对话：先"无中生有"地问 → 两次"请记住"写入不同类别记忆 → 最后跨轮复述验证记忆闭环
const prompts = [
  "根据记忆，这个项目是做什么的？只答一句。", // 记忆为空，模型只能泛泛回答或说不知道
  `请记住：我常用的包管理器是 pnpm。`, // 个人偏好 → 应写入 preferences.md
  `请记住：本仓库主入口脚本是 src/deepagents/memory-agent.mjs。`, // 项目事实 → 应写入 AGENTS.md
  "我常用什么包管理器？本 demo 主入口脚本路径是什么？各用一行回答。", // 跨轮验证：靠注入的记忆回答
];

let messages = []; // 累积整个会话的消息，让模型有"当前轮上下文"

for (const prompt of prompts) {
  console.log("\n用户:", prompt);
  // 每一轮都带上历史消息 invoke，触发 memory 中间件注入 + 模型可能的记忆写入动作
  ({ messages } = await agent.invoke(
    { messages: [...messages, new HumanMessage(prompt)] },
    { recursionLimit: 30 } // 允许足够的递归轮数让模型完成"写入记忆"动作链
  ));
  console.log("回复:", messages.at(-1)?.content); // 打印模型最终回复
}

// 对话结束后回读两个记忆文件，直观展示"模型写入了什么"
for (const p of [projectMemoryPath, preferencesMemoryPath]) {
  const file = path.join(workspaceDir, p.replace(/^\//, "")); // 虚拟路径 → 真实磁盘路径（去掉前导 /）
  console.log(`\n--- ${p} ---\n`, fs.readFileSync(file, "utf8"));
}
