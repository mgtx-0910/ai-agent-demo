/**
 * langchain-mcp-test.mjs — LangChain 集成 MCP 客户端测试
 *
 * 功能：通过 LangChain 的 MultiServerMCPClient 连接本地 MCP 服务器，
 *       在对话前先读取 MCP 服务器的资源文档（使用指南），
 *       再基于资源内容和工具进行 Agent 式问答
 *
 * 与 mcp-test.mjs 的区别：
 *   - 只连接一个 MCP 服务器（my-mcp-server）
 *   - 在对话中添加 MCP 资源作为 SystemMessage，让模型了解服务器能力
 *   - 更轻量，适合初次学习 MCP 集成
 */

// 加载环境变量
import "dotenv/config";
// MCP 多服务器客户端
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
// LLM 聊天模型
import { ChatOpenAI } from "@langchain/openai";
// 终端彩色输出
import chalk from "chalk";
// LangChain 消息类型
import {
  HumanMessage,
  SystemMessage,
  ToolMessage
} from "@langchain/core/messages";

// ========== 1. 初始化模型 ==========
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME || "qwen-plus",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  }
});

// ========== 2. 连接 MCP 服务器 ==========
const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    // 只连接本地 my-mcp-server
    "my-mcp-server": {
      command: "node",
      args: ["d:/ai-study/ai-agent-demo/tool-test/src/my-mcp-server.mjs"]
    }
  }
});

// 获取 MCP 服务器提供的工具
const tools = await mcpClient.getTools();
const modelWithTools = model.bindTools(tools);

// ========== 3. 读取 MCP 服务器的资源（使用指南） ==========
// listResources 获取所有 MCP 服务器注册的资源列表
const res = await mcpClient.listResources();

let resourceContent = "";
for (const [serverName, resources] of Object.entries(res)) {
  for (const resource of resources) {
    // readResource 读取每个资源的内容
    const content = await mcpClient.readResource(serverName, resource.uri);
    resourceContent += content[0].text;
  }
}

// ========== 4. Agent 循环（带 SystemMessage 资源上下文） ==========
async function runAgentWithTools(query, maxIterations = 30) {
  // 将 MCP 资源内容作为系统消息注入，帮助模型理解可用功能
  const messages = [
    new SystemMessage(resourceContent),
    new HumanMessage(query)
  ];

  for (let i = 0; i < maxIterations; i++) {
    console.log(chalk.bgGreen(`⏳ 正在等待 AI 思考...`));
    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    // 检查是否有工具调用，没有则说明是最终答案
    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`\n✨ AI 最终回复:\n${response.content}\n`);
      return response.content;
    }

    console.log(
      chalk.bgBlue(`🔍 检测到 ${response.tool_calls.length} 个工具调用`)
    );
    console.log(
      chalk.bgBlue(
        `🔍 工具调用: ${response.tool_calls.map((t) => t.name).join(", ")}`
      )
    );
    // 执行工具调用
    for (const toolCall of response.tool_calls) {
      const foundTool = tools.find((t) => t.name === toolCall.name);
      if (foundTool) {
        const toolResult = await foundTool.invoke(toolCall.args);
        messages.push(
          new ToolMessage({
            content: toolResult,
            tool_call_id: toolCall.id
          })
        );
      }
    }
  }

  return messages[messages.length - 1].content;
}

// ========== 5. 执行测试 ==========
await runAgentWithTools("查一下用户 002 的信息");
// await runAgentWithTools("MCP Server 的使用指南是什么");

// 关闭 MCP 客户端连接
await mcpClient.close();
