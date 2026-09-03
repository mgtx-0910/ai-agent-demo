// ============================================================================
// src/cli.mjs — 深度调研助手 CLI 入口
//
// 职责：
//   1. 加载项目根目录的 .env 环境变量
//      （OPENAI_API_KEY / BOCHA_API_KEY / RECURSION_LIMIT 等）
//   2. 从命令行参数或交互式提问读取调研主题
//   3. 以流式方式运行主 Agent（streamMode: updates + subgraphs: true），
//      实时打印各 Agent（含子 Agent）的执行步骤与文件 / eval 工具调用
//   4. 运行结束后列出 workspace 下本次产出的 sources / reports 文件
// ============================================================================
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { HumanMessage } from "@langchain/core/messages";

import { createIntelligenceDeskAgent, projectDir } from "./agent.mjs";

// 项目根目录（src/ 的上一级）
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
// 加载根目录 .env（文件不存在时 dotenv 会静默跳过）
loadEnv({ path: path.join(projectRoot, ".env") });

// 递归上限：防止 Agent 无限循环；执行复杂任务时可调大 RECURSION_LIMIT
const recursionLimit = Number(process.env.RECURSION_LIMIT) || 300;

// 需要在前端日志中追踪路径/内容的文件系统工具集合
const FILE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "read_file",
  "ls",
  "glob",
  "grep",
]);

// QuickJS 数据分析 REPL 工具名（由 analyst 子 Agent 中间件注入）
const EVAL_TOOL = "eval";

// 日志预览长度限制：入参与结果只展示开头，避免刷屏
const PREVIEW_LEN = 100;
const RESULT_PREVIEW_LEN = 120;

/** 打印 CLI 启动横幅 */
function printBanner() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║              深度调研助手              ║");
  console.log("╚══════════════════════════════════════════╝\n");
}

/**
 * 读取调研主题：
 * - 优先取命令行参数（如 `node src/cli.mjs "调研 XX"`）
 * - 否则交互式提问，等待用户输入
 * @returns {Promise<string>} 调研主题
 */
async function readQuery() {
  const fromArgs = process.argv.slice(2).join(" ").trim();
  if (fromArgs) return fromArgs;

  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question("请输入调研主题: ")).trim();
  } finally {
    rl.close();
  }
}

/**
 * 生成步骤标签，用于区分主/子 Agent。
 * 例：`[主 Agent] model_request`、`[subagent:researcher] model_request`
 */
function stepLabel(namespace, node) {
  if (namespace.length === 0) return `[主 Agent] ${node}`;
  const id = namespace[0]?.replace(/^tools:/, "subagent:") ?? namespace[0];
  return `[${id}] ${node}`;
}

/**
 * 把 Agent 视角的虚拟路径转换为相对项目根的可读路径。
 * 例：/workspace/sources/a.md -> workspace/sources/a.md
 */
function displayPath(p) {
  return p.startsWith("/workspace/") ? p.slice(1) : p.replace(/^\/+/, "");
}

/**
 * 根据工具名，从工具入参中提取将要操作的文件/目录路径。
 * @returns {string|null} 路径字符串；无法提取时返回 null
 */
function pathFromArgs(name, args) {
  if (!args || typeof args !== "object") return null;
  if (name === "write_file" || name === "edit_file" || name === "read_file") {
    return typeof args.file_path === "string" ? args.file_path : null;
  }
  if (name === "ls") return typeof args.path === "string" ? args.path : null;
  if (name === "glob" || name === "grep") {
    const dir = typeof args.path === "string" ? args.path : "/";
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    return pattern ? `${pattern} @ ${dir}` : dir;
  }
  return null;
}

/**
 * 工具入参可能是 JSON 字符串，统一尝试解析为对象。
 * @returns {Object|string}
 */
function parseArgs(args) {
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return args;
    }
  }
  return args;
}

/**
 * 将任意文本压成单行并截断，用于日志预览。
 * @returns {string} 空内容返回 "(empty)"
 */
function previewText(text, maxLen) {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  if (!oneLine) return "(empty)";
  return oneLine.length <= maxLen ? oneLine : `${oneLine.slice(0, maxLen - 1)}…`;
}

/**
 * 在 model_request 阶段"预登记" eval 调用：
 * 打印即将执行的代码片段，并把 tool_call_id -> 代码存入 pendingEval，
 * 等 tools 阶段拿到结果后配对输出。
 */
function trackEvalCalls(data, pendingEval) {
  for (const msg of data?.messages ?? []) {
    for (const tc of msg.tool_calls ?? []) {
      if (!tc.id || tc.name !== EVAL_TOOL) continue;
      const args = parseArgs(tc.args);
      const code =
        args && typeof args === "object" && typeof args.code === "string"
          ? args.code
          : "";
      pendingEval.set(tc.id, code);
      console.log(`  🧮 eval: ${previewText(code, PREVIEW_LEN)}`);
    }
  }
}

/**
 * 在 model_request 阶段"预登记"文件系统工具调用，
 * 以便 tools 阶段能打印实际操作的文件路径。
 */
function trackFileCalls(data, pending) {
  for (const msg of data?.messages ?? []) {
    for (const tc of msg.tool_calls ?? []) {
      if (!tc.id || !tc.name || !FILE_TOOLS.has(tc.name)) continue;
      const p = pathFromArgs(tc.name, parseArgs(tc.args));
      if (p) pending.set(tc.id, { name: tc.name, path: p });
    }
  }
}

/**
 * 在 tools 阶段打印工具执行结果：
 *  - task（子 Agent 委派）→ 结果摘要
 *  - eval（REPL 计算）→ 计算结果预览
 *  - 文件系统工具 → 实际操作的文件路径
 */
function logToolResults(data, pending, pendingEval) {
  for (const msg of data?.messages ?? []) {
    if (msg.type !== "tool") continue;

    // 子 Agent 委派结果
    if (msg.name === "task") {
      const preview = String(msg.content).slice(0, 120).replace(/\n/g, " ");
      console.log(`  task done: ${preview}...`);
      continue;
    }

    // QuickJS eval 计算结果
    if (msg.name === EVAL_TOOL) {
      console.log(
        `  🧮 eval → ${previewText(msg.content, RESULT_PREVIEW_LEN)}`,
      );
      if (msg.tool_call_id) pendingEval.delete(msg.tool_call_id);
      continue;
    }

    // 文件系统工具：优先使用之前登记的路径，失败时从返回内容中猜测
    if (!msg.name || !FILE_TOOLS.has(msg.name)) continue;

    const op = msg.tool_call_id ? pending.get(msg.tool_call_id) : undefined;
    const filePath =
      op?.path ?? String(msg.content).match(/['`](\/[^'`]+)['`]/)?.[1] ?? null;

    console.log(
      filePath ? `  ${msg.name}: ${displayPath(filePath)}` : `  ${msg.name}`,
    );
    if (msg.tool_call_id) pending.delete(msg.tool_call_id);
  }
}

/**
 * 以流式 updates 方式运行 Agent，逐条打印每个节点的执行状态。
 * @param {string} query - 调研主题
 */
async function run(query) {
  console.log(`query: ${query}`);
  console.log(`recursionLimit: ${recursionLimit}\n`);
  console.log("─".repeat(50));

  const agent = createIntelligenceDeskAgent();
  const pending = new Map(); // tool_call_id -> 文件操作登记
  const pendingEval = new Map(); // tool_call_id -> eval 代码登记

  for await (const [namespace, chunk] of await agent.stream(
    { messages: [new HumanMessage(query)] },
    { streamMode: "updates", subgraphs: true, recursionLimit },
  )) {
    for (const [node, data] of Object.entries(chunk)) {
      if (node === "model_request") {
        // 模型发出工具调用请求：先登记再打印节点名
        trackFileCalls(data, pending);
        trackEvalCalls(data, pendingEval);
        console.log(stepLabel(namespace, node));
      } else if (node === "tools") {
        // 工具执行结果
        logToolResults(data, pending, pendingEval);
      } else if (node === "todoListMiddleware.after_model") {
        // todo 列表中间件的步骤节点
        console.log(stepLabel(namespace, node));
      }
    }
  }

  console.log("─".repeat(50));
}

/**
 * 列出目录下的 .md 文件，按修改时间倒序（最新的在前）。
 * @returns {string[]} 文件绝对路径数组
 */
function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/** 打印本次运行产出的 sources / reports 文件（各取最近若干份） */
function printOutputs() {
  const sources = listMd(path.join(projectDir, "workspace/sources"));
  const reports = listMd(path.join(projectDir, "workspace/reports"));

  if (sources.length) {
    console.log("\n sources:");
    for (const f of sources.slice(0, 8)) {
      console.log(`   ${path.relative(projectDir, f)}`);
    }
  }
  if (reports.length) {
    console.log("\n reports:");
    for (const f of reports.slice(0, 5)) {
      console.log(`   ${path.relative(projectDir, f)}`);
    }
  }
}

/** CLI 主流程：校验密钥 → 读取主题 → 运行 Agent → 展示产出 */
async function main() {
  printBanner();

  // 启动前校验 API Key，缺失时给出引导提示
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("Missing OPENAI_API_KEY — copy .env.example to .env");
    process.exit(1);
  }

  const query = await readQuery();
  if (!query) {
    console.error("请提供调研主题");
    process.exit(1);
  }

  try {
    await run(query);
    printOutputs();
    console.log("\n✅ done");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Recursion limit")) {
      // 到达递归上限：提示用户调大 RECURSION_LIMIT
      console.error(`\n❌ recursion limit (${recursionLimit}) — set RECURSION_LIMIT in .env`);
    } else {
      console.error("\n❌", err);
    }
    printOutputs();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
