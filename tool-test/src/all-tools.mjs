/**
 * all-tools.mjs — 自定义 LangChain 工具集
 *
 * 本模块定义了 4 个可供 LLM Agent 调用的工具：
 *   1. read_file       — 读取指定文件内容
 *   2. write_file      — 写入文件（自动创建目录）
 *   3. execute_command  — 执行系统命令（支持指定工作目录）
 *   4. list_directory  — 列出目录内容
 *
 * 所有工具使用 LangChain 的 tool() 函数创建，通过 Zod 定义参数 schema。
 * 这些工具会被 mini-cursor.mjs 等 Agent 脚本导入使用。
 *
 * @see mini-cursor.mjs — 使用本文件工具集的 LLM Agent 演示
 */

// LangChain 工具工厂函数
import { tool } from "@langchain/core/tools";
// Node.js 文件系统（Promise 版本）
import fs from "node:fs/promises";
// Node.js 路径处理
import path from "node:path";
// Node.js 子进程管理
import { spawn } from "node:child_process";
// 参数校验库
import { z } from "zod";

// ========== 1. 读取文件工具 ==========
const readFileTool = tool(
  async ({ filePath }) => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      console.log(
        `  [工具调用] read_file("${filePath}") - 成功读取 ${content.length} 字节`
      );
      return `文件内容:\n${content}`;
    } catch (error) {
      console.log(
        `  [工具调用] read_file("${filePath}") - 错误: ${error.message}`
      );
      return `读取文件失败: ${error.message}`;
    }
  },
  {
    name: "read_file",
    description: "读取指定路径的文件内容",
    schema: z.object({
      filePath: z.string().describe("文件路径")
    })
  }
);

// ========== 2. 写入文件工具 ==========
// 自动创建目标目录，无需手动 mkdir
const writeFileTool = tool(
  async ({ filePath, content }) => {
    try {
      // 确保目标目录存在（递归创建）
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      console.log(
        `  [工具调用] write_file("${filePath}") - 成功写入 ${content.length} 字节`
      );
      return `文件写入成功: ${filePath}`;
    } catch (error) {
      console.log(
        `  [工具调用] write_file("${filePath}") - 错误: ${error.message}`
      );
      return `写入文件失败: ${error.message}`;
    }
  },
  {
    name: "write_file",
    description: "向指定路径写入文件内容，自动创建目录",
    schema: z.object({
      filePath: z.string().describe("文件路径"),
      content: z.string().describe("要写入的文件内容")
    })
  }
);

// ========== 3. 执行命令工具（带实时输出） ==========
// 使用 spawn 而非 exec，支持实时输出到控制台
const executeCommandTool = tool(
  async ({ command, workingDirectory }) => {
    const cwd = workingDirectory || process.cwd();
    console.log(
      `  [工具调用] execute_command("${command}")${workingDirectory ? ` - 工作目录: ${workingDirectory}` : ""}`
    );

    return new Promise((resolve, reject) => {
      // 解析命令名和参数（按空格分割）
      const [cmd, ...args] = command.split(" ");

      // spawn 创建子进程
      const child = spawn(cmd, args, {
        cwd,            // 指定工作目录
        stdio: "inherit", // 子进程的输出直接继承父进程（控制台实时显示）
        shell: true      // 通过 shell 执行（支持管道、重定向等 shell 语法）
      });

      let errorMsg = "";

      child.on("error", (error) => {
        errorMsg = error.message;
      });

      child.on("close", (code) => {
        if (code === 0) {
          console.log(`  [工具调用] execute_command("${command}") - 执行成功`);
          const cwdInfo = workingDirectory
            ? `\n\n重要提示：命令在目录 "${workingDirectory}" 中执行成功。如果需要在这个项目目录中继续执行命令，请使用 workingDirectory: "${workingDirectory}" 参数，不要使用 cd 命令。`
            : "";
          resolve(`命令执行成功: ${command}${cwdInfo}`);
        } else {
          console.log(
            `  [工具调用] execute_command("${command}") - 执行失败，退出码: ${code}`
          );
          resolve(
            `命令执行失败，退出码: ${code}${errorMsg ? "\n错误: " + errorMsg : ""}`
          );
        }
      });
    });
  },
  {
    name: "execute_command",
    description: "执行系统命令，支持指定工作目录，实时显示输出",
    schema: z.object({
      command: z.string().describe("要执行的命令"),
      workingDirectory: z.string().optional().describe("工作目录（推荐指定）")
    })
  }
);

// ========== 4. 列出目录内容工具 ==========
const listDirectoryTool = tool(
  async ({ directoryPath }) => {
    try {
      const files = await fs.readdir(directoryPath);
      console.log(
        `  [工具调用] list_directory("${directoryPath}") - 找到 ${files.length} 个文件`
      );
      return `目录内容:\n${files.map((f) => `- ${f}`).join("\n")}`;
    } catch (error) {
      console.log(
        `  [工具调用] list_directory("${directoryPath}") - 错误: ${error.message}`
      );
      return `列出目录失败: ${error.message}`;
    }
  },
  {
    name: "list_directory",
    description: "列出指定目录下的所有文件和文件夹",
    schema: z.object({
      directoryPath: z.string().describe("目录路径")
    })
  }
);

// 导出所有工具供其他模块使用
export { readFileTool, writeFileTool, executeCommandTool, listDirectoryTool };
