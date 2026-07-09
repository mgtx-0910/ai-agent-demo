/**
 * tool-file-read.mjs — 最小化的 LangChain Tool calling 示例
 *
 * 功能：演示 LLM 如何根据用户输入，自主决定调用哪个工具
 *
 * 流程：
 *   1. 定义一个 read_file 工具（读取本地文件）
 *   2. 将工具绑定到 ChatOpenAI 模型
 *   3. 用户说"读取 xx 文件"，模型自动识别并发起工具调用
 *
 * 这是学习 LangChain Tool Calling 的最小可运行示例。
 */

// 加载环境变量
import "dotenv/config";
// LLM 聊天模型
import { ChatOpenAI } from "@langchain/openai";
// LangChain 工具工厂函数
import { tool } from "@langchain/core/tools";
// LangChain 消息类型
import {
  HumanMessage,
  SystemMessage,
  ToolMessage
} from "@langchain/core/messages";
// Node.js 文件系统
import fs from "node:fs/promises";
// 参数校验
import { z } from "zod";

// ========== 1. 初始化模型 ==========
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME || "qwen-coder-turbo",
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  }
});

// ========== 2. 定义 read_file 工具 ==========
const readFileTool = tool(
  async ({ filePath }) => {
    const content = await fs.readFile(filePath, "utf-8");
    console.log(
      `  [工具调用] read_file("${filePath}") - 成功读取 ${content.length} 字节`
    );
    return `文件内容:\n${content}`;
  },
  {
    name: "read_file",
    description:
      "用此工具来读取文件内容。当用户要求读取文件、查看代码、分析文件内容时，调用此工具。输入文件路径（可以是相对路径或绝对路径）。",
    schema: z.object({
      filePath: z.string().describe("要读取的文件路径")
    })
  }
);

// 工具列表（目前只有一个）
const tools = [readFileTool];

// 绑定工具到模型
const modelWithTools = model.bindTools(tools);

// ========== 3. 构建对话 ==========
const messages = [
  // 系统提示：告诉模型它是谁、有哪些工具、工作流程
  new SystemMessage(`你是一个代码助手，可以使用工具读取文件并解释代码。

工作流程：
1. 用户要求读取文件时，立即调用 read_file 工具
2. 等待工具返回文件内容
3. 基于文件内容进行分析和解释

可用工具：
- read_file: 读取文件内容（使用此工具来获取文件内容）
`),
  new HumanMessage("请读取 src/tool-file-read.mjs 文件内容并解释代码")
];

// ========== 4. 第一轮：模型返回 tool_calls（而非文本） ==========
let response = await modelWithTools.invoke(messages);
console.log(response);
messages.push(response);

// ========== 5. 执行工具调用 ==========
while (response.tool_calls && response.tool_calls.length > 0) {
  console.log(`\n[检测到 ${response.tool_calls.length} 个工具调用]`);

  // 遍历并执行每个工具调用
  for (const toolCall of response.tool_calls) {
    const foundTool = tools.find((t) => t.name === toolCall.name);
    if (foundTool) {
      // 执行工具
      const toolResult = await foundTool.invoke(toolCall.args);
      // 将工具结果作为 ToolMessage 加入对话
      messages.push(
        new ToolMessage({
          content: toolResult,
          tool_call_id: toolCall.id
        })
      );
    }
  }

  // 工具执行完后，再次调用模型，让它基于工具结果生成最终回答
  response = await modelWithTools.invoke(messages);
  console.log("\n【模型基于工具结果的回复】");
  console.log(response.content);
}
