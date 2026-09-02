/**
 * skills-agent.mjs —— Skills 中间件 Demo：Agent 按需读取 SKILL.md，调用外部技能库完成任务
 *
 * 核心演示点：
 *   1. createSkillsMiddleware：把 /.agents/skills/ 下的技能（每个技能 = 一个含 SKILL.md 的目录）
 *      暴露给 Agent，模型可在每轮决定读取哪个技能的 SKILL.md 来获得"专家操作手册"
 *   2. 与 createFilesystemMiddleware / LocalShellBackend 组合：技能文件 + 工作区文件统一在
 *      "虚拟根 / + 真实 shell" 的混合后端上读写
 *   3. 实战场景：让 Agent 调用 excalidraw-diagram-generator 技能，把项目工作流画成
 *      excalidraw 格式流程图并保存（JSON 文件可用 excalidraw.com 打开查看）
 *
 * 运行方式：
 *   1) 先安装技能（首次）：npx skills add github/awesome-copilot --skill excalidraw-diagram-generator -y
 *   2) node src/deepagents/skills-agent.mjs
 *
 * 产物：src/deepagents/output/deepagents-skills-flow.excalidraw
 *
 * 前置条件：.env 已配置模型相关环境变量；技能目录存在
 */
import "dotenv/config"; // 加载 .env 到 process.env
import { existsSync, mkdirSync } from "node:fs"; // 文件系统：检查技能是否存在、创建输出目录
import { ChatOpenAI } from "@langchain/openai"; // 对话模型（OpenAI 兼容协议）
import { createAgent, HumanMessage } from "langchain"; // createAgent：组装 Agent
import {
  LocalShellBackend,
  createFilesystemMiddleware,
  createSkillsMiddleware,
} from "deepagents"; // deepagents：本机 Shell 后端 + 文件系统 + 技能中间件

const skills = "/.agents/skills/"; // 技能库在虚拟根路径下的位置
const output = "src/deepagents/output/deepagents-skills-flow.excalidraw"; // 成品相对本仓库根的落盘路径

// 前置校验：技能没安装就尽早报错并给出安装命令，而不是让模型跑一半才失败
if (!existsSync(".agents/skills/excalidraw-diagram-generator/SKILL.md")) {
  throw new Error(
    "未找到 excalidraw-diagram-generator，请先: npx skills add github/awesome-copilot --skill excalidraw-diagram-generator -y"
  );
}

mkdirSync("src/deepagents/output", { recursive: true }); // 确保输出目录存在（不存在则递归创建）

// 模型实例：streaming 开启，便于在控制台实时看到模型逐字输出
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
  streaming: true,
});

// 本机 Shell 后端：可执行真实 shell 命令，并同样具备虚拟根路径映射能力
const backend = await LocalShellBackend.create({
  rootDir: ".", // 后端根目录 = 仓库根
  virtualMode: true, // 虚拟路径模式
  inheritEnv: true, // 继承当前进程环境变量（技能脚本/命令需要时能读到）
});

// 组装 Agent：Skills 中间件负责暴露技能，Filesystem 中间件负责文件读写工具
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: "按 skills 库完成任务，需要时 read_file 对应 SKILL.md。中文回答。",
  middleware: [
    createSkillsMiddleware({ backend, sources: [skills] }), // 声明技能库来源
    createFilesystemMiddleware({ backend }),
  ],
});

// 任务提示词：让模型画出本项目 skills-agent 的工作流流程图
const prompt = [
  "画一张流程图，描述本项目的 skills-agent 工作流：",
  "用户 Prompt → createAgent → createSkillsMiddleware → createFilesystemMiddleware → 模型回复。",
  `保存为 ${output}。要求：`,
  "- 顶部大标题 + 副标题",
  "- 每个主节点 numbered（①②…）且框内 2～3 行中文说明",
  "- 右侧一列「说明：…」补充细节",
  "- 箭头上标注阶段名（如 invoke、wrapModelCall）",
  "- 底部图例（颜色含义 + 如何运行 demo）",
].join("\n");

console.log("用户:", prompt);

/**
 * 从流式 chunk 中提取纯文本：
 * LangChain 流式内容可能是字符串 / 含 text 字段的对象数组等结构，这里统一摊平成文本
 * @param {unknown} chunk 流事件里的内容片段
 * @returns {string} 拼接后的纯文本
 */
function chunkText(chunk) {
  if (!chunk?.content) return ""; // 空片段直接返回
  if (typeof chunk.content === "string") return chunk.content; // 最常见：纯字符串
  if (Array.isArray(chunk.content)) {
    // 内容块数组：逐块取字符串或其中的 text 字段后拼接
    return chunk.content
      .map((p) => (typeof p === "string" ? p : (p?.text ?? "")))
      .join("");
  }
  return "";
}

// 以流式事件方式跑任务，实时打印模型输出与工具调用
const stream = await agent.streamEvents(
  { messages: [new HumanMessage(prompt)] },
  { recursionLimit: 100 } // 技能流程较长，放宽递归上限
);

let skillsMetadata; // 用于收集中间件透传的技能元信息（skill 名列表等）
console.log("\n--- 流式输出 ---\n");

try {
  for await (const event of stream) {
    if (event.event === "on_chat_model_stream") {
      // 模型增量输出：逐字写到 stdout，形成打字机效果
      const text = chunkText(event.data?.chunk);
      if (text) process.stdout.write(text);
    }
    if (event.event === "on_tool_start") {
      // 工具开始执行：打印工具名（事件名是路径形式，取最后一段）
      const name = event.name?.split("/").pop() ?? event.name;
      process.stdout.write(`\n\n→ ${name}\n\n`);
    }
    if (event.event === "on_chain_end" && event.data?.output?.skillsMetadata) {
      // 整链结束：抓取返回结果里由 skills 中间件附加的技能元数据
      skillsMetadata = event.data.output.skillsMetadata;
    }
  }
} catch (e) {
  console.error("\n\n[错误]", e.cause?.message ?? e.message);
  throw e;
}

// 收尾：打印识别到的技能清单，并确认产物是否已生成
console.log("\n");
console.log("skills:", skillsMetadata?.map((s) => s.name));
if (existsSync(output)) {
  console.log("图表:", output);
  console.log("打开: https://excalidraw.com → Open → 选择该文件");
} else {
  console.log("未生成:", output);
}

// 释放 shell 后端资源（关闭进程/连接等）
await backend.close();
