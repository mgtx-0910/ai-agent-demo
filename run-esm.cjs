/**
 * run-esm.cjs — CJS 壳脚本，保护 ESM 文件免受 CodeBuddy 的 --require 注入
 *
 * 原理：
 *   1. CJS 文件可以接受 CodeBuddy 注入的 --require（不会报 ERR_REQUIRE_ESM）
 *   2. child_process.spawn() 创建的子进程不继承父进程的 execArgv
 *   3. 同时清除 NODE_OPTIONS / VSCODE_INSPECTOR_OPTIONS 环境变量
 *
 * 用法：
 *   node run-esm.cjs <target-file.mjs> [args...]
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const target = process.argv[2];
if (!target) {
  console.error("用法: node run-esm.cjs <target-file.mjs> [args...]");
  process.exit(1);
}

// 准备干净的环境变量，斩断 CodeBuddy 注入链条
delete process.env.NODE_OPTIONS;
delete process.env.VSCODE_INSPECTOR_OPTIONS;

// 优先使用外层 ai-agent-study 目录封装的 Node 版本（v24.18.0）
// 回退到当前 node 执行路径（注意：旧版本 Node 如 v12 无法运行现代 ESM）
function findNodeExecutable() {
  const candidates = [
    // 与当前项目同处 ai-agent-study 工作区根目录的 node 封装脚本
    path.resolve(__dirname, "..", "node.cmd"),
    path.resolve(__dirname, "..", "node.ps1"),
    // 当前系统 PATH 中的 node
    process.execPath,
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return process.execPath;
}

const nodeExecutable = findNodeExecutable();

// resolve 目标文件路径
const resolvedTarget = path.resolve(target);

// 在 cmd 中执行 .cmd 文件时，需要显式使用 cmd /c
const isCmdScript = nodeExecutable.toLowerCase().endsWith(".cmd");
const cmd = isCmdScript ? "cmd" : nodeExecutable;
const args = isCmdScript
  ? ["/c", nodeExecutable, resolvedTarget, ...process.argv.slice(3)]
  : [resolvedTarget, ...process.argv.slice(3)];

// spawn 创建全新进程，不继承父进程的 execArgv（--require 注入到此为止）
const child = spawn(cmd, args, {
  stdio: "inherit",
  cwd: process.cwd(),
  shell: false,
});

child.on("close", (code) => {
  process.exit(code == null ? 0 : code);
});

child.on("error", (err) => {
  console.error(`[run-esm] 启动子进程失败: ${err.message}`);
  process.exit(1);
});
