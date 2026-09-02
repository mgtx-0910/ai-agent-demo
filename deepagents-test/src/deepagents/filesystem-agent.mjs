/**
 * filesystem-agent.mjs —— Filesystem 中间件 Demo：给 Agent 一个带权限管控的虚拟文件系统
 *
 * 核心演示点：
 *   1. FilesystemBackend：把真实目录 src/deepagents/workspace/ 映射为 Agent 视角的「虚拟根路径 /」，
 *      隔离模型实际能触碰的文件范围（virtualMode 使模型只能看到后端根目录以内的世界）
 *   2. createFilesystemMiddleware：自动为 Agent 注册 ls / read_file / write_file / edit_file 等工具
 *   3. permissions：声明式权限规则（操作 + 路径 → 放行/拒绝），模拟「允许写 TODO、禁止读机密」的安全边界
 *
 * 规则语义（见下方 permissions 数组）：
 *   - 从上到下逐条匹配，先命中先生效
 *   - 所有规则都没命中时默认「放行」（如本示例顶层未兜底 deny 全路径写之外的场景）
 *
 * 运行方式：
 *   node src/deepagents/filesystem-agent.mjs
 *
 * 前置条件：.env 已配置模型相关环境变量（复制 .env.example 为 .env 并填写）
 */
import "dotenv/config"; // 加载 .env 到 process.env
import fs from "node:fs"; // 文件系统：准备/清理真实工作区
import path from "node:path"; // 路径拼接
import { fileURLToPath } from "node:url"; // 把 import.meta.url 转成可用的文件路径
import { ChatOpenAI } from "@langchain/openai"; // 对话模型（OpenAI 兼容协议，本项目接阿里百炼）
import { createAgent, HumanMessage } from "langchain"; // createAgent：把 model+middleware 组装成可 invoke 的 Agent
import { createFilesystemMiddleware, FilesystemBackend } from "deepagents"; // deepagents：文件系统后端 + 中间件

// 真实工作区目录 = 本脚本同级的 workspace/（虚拟文件系统的物理落盘位置）
const workspaceDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "workspace"
);

/** 权限规则：先匹配先生效；未命中任何规则则默认允许 */
const permissions = [
  { operations: ["read"], paths: ["/secret.txt"], mode: "deny" }, // ① 禁止读取机密文件
  { operations: ["write"], paths: ["/todo.md"], mode: "allow" }, // ② 只允许写待办文件
  { operations: ["write"], paths: ["/**"], mode: "deny" }, // ③ 其余任何路径的写操作一律拒绝
];

// 重建工作区：先清空再新建，保证每次运行都是干净环境；写一个机密文件用于演示读取被拒
fs.rmSync(workspaceDir, { recursive: true, force: true }); // 递归删除旧工作区（不存在也不报错）
fs.mkdirSync(workspaceDir); // 创建全新工作区目录
fs.writeFileSync(path.join(workspaceDir, "secret.txt"), "机密：不得读取", "utf8");

// 模型实例：temperature=0 让工具调用/输出尽量确定
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
});

// 组装 Agent：本 demo 不预注册工具，文件操作工具全部由 Filesystem 中间件注入
const agent = createAgent({
  model,
  tools: [],
  systemPrompt:
    "工作区根路径为 /。用 ls、read_file、write_file、edit_file 操作文件，路径以 / 开头。中文回答。",
  middleware: [
    createFilesystemMiddleware({
      backend: new FilesystemBackend({ rootDir: workspaceDir, virtualMode: true }), // 虚拟文件系统后端
      permissions, // 注入上面声明的权限规则，模型越权操作会被中间件拦截并报错
    }),
  ],
});

// 打印运行信息，便于对照观察
console.log("工作区:", workspaceDir);
console.log("权限:", JSON.stringify(permissions, null, 2));

/**
 * 跑一轮正常（预期放行）的提问：invoke 后打印模型实际发起的工具调用与最终回复
 * @param {string} label 场景名（仅用于控制台展示）
 * @param {string} prompt 用户问题
 */
async function run(label, prompt) {
  console.log(`\n=== ${label} ===\n`, prompt, "\n");
  const { messages } = await agent.invoke(
    { messages: [new HumanMessage(prompt)] },
    { recursionLimit: 20 } // 限制 Agent 内部最多 20 轮（防工具循环失控）
  );
  // 遍历对话消息，把每轮消息里的工具调用名打印出来，方便看到 Agent 的动作序列
  for (const m of messages) {
    for (const t of m.tool_calls ?? []) console.log("→", t.name);
  }
  console.log("回复:", messages.at(-1)?.content); // 打印最后一条消息（模型最终回答）
}

/**
 * 跑一轮预期被权限拒绝的提问。
 * 注意：deepagents 的权限拦截不会抛给 invoke，而是把 permission denied 作为
 * ToolMessage 反馈给模型、由模型自行收尾，invoke 正常返回。因此这里不再以
 * 「是否抛异常」判定，而是断言两项事实：
 *   ① 消息流中是否出现 permission denied 的拦截痕迹
 *   ②（可选）越权目标文件是否真的没落盘
 * @param {string} label 场景名
 * @param {string} prompt 用户问题（应触发越权操作）
 * @param {string} [forbiddenFile] 若该越权操作意图是写文件，传文件名用于副作用断言
 */
async function expectDenied(label, prompt, forbiddenFile = null) {
  console.log(`\n=== ${label}（预期拒绝）===\n`, prompt, "\n");
  let messages;
  try {
    ({ messages } = await agent.invoke(
      { messages: [new HumanMessage(prompt)] },
      { recursionLimit: 5 }
    ));
  } catch (e) {
    // 权限错误不会冒泡到这里；能抛出来的通常是模型反复越权不死心触发的 recursion limit，
    // 异常本身已证明它没能成功越权，剩下的交给磁盘副作用断言兜底
    console.log("✗ invoke 异常中断:", e.message.split("\n")[0]);
  }
  // ① 拦截痕迹：模型实际收到过 permission denied 的工具反馈
  const hit = (messages ?? []).some((m) => String(m.content).includes("permission denied"));
  console.log(hit ? "✓ 已被权限拦截（模型收到 permission denied）" : "✗ 未见拦截痕迹");
  // ② 磁盘副作用：越权要写的文件不允许真的出现
  if (forbiddenFile) {
    const leaked = fs.existsSync(path.join(workspaceDir, forbiddenFile));
    console.log(leaked ? "✗ 越权文件仍被写入！" : "✓ 越权目标文件未落盘");
  }
}

// ① 正常场景：写 TODO → 编辑标记完成 → 列出目录（write /todo.md 在权限白名单内）
await run(
  "允许的操作",
  "write_file 创建 /todo.md（三条待办），edit_file 把第一条标为完成，ls /，一句话总结。"
);

// ② 越权场景 1：read_file 读 /secret.txt —— 被权限①拒绝
await expectDenied("禁止读", "只调用 read_file，路径 /secret.txt。");
// ③ 越权场景 2：write_file 写 /hack.txt —— 被权限③（全路径写默认拒绝）拦截；用 hack.txt 做落盘断言
await expectDenied("禁止写", "只调用 write_file，路径 /hack.txt，内容 test。", "hack.txt");
