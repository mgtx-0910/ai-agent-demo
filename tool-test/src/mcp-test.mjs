/**
 * mcp-test.mjs — 多 MCP 服务器集成测试
 *
 * 功能：同时连接多个 MCP 服务器，通过自然语言让 LLM 自动调度工具完成任务
 *
 * 连接的 MCP 服务器：
 *   1. my-mcp-server       — 自定义用户查询服务（本地 Node 进程）
 *   2. amap-maps           — 高德地图 API（酒店搜索、路线规划）
 *   3. filesystem          — 文件系统操作（读写本地文件）
 *   4. chrome-devtools     — Chrome 浏览器自动化（打开页面、截图等）
 *
 * 流程：
 *   - 初始化模型 → 连接所有 MCP 服务器 → 获取工具列表 → Agent 循环调用
 */

// 加载环境变量
import "dotenv/config";
// MCP 多服务器客户端：统一管理多个 MCP 服务连接
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

// ========== 1. 初始化 LLM 模型 ==========
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME || "qwen-plus",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  }
});

// ========== 2. 连接多个 MCP 服务器 ==========
const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    // 本地自定义 MCP 服务器（用户查询工具）
    "my-mcp-server": {
      command: "node",
      args: ["d:/ai-study/ai-agent-demo/tool-test/src/my-mcp-server.mjs"]
    },
    // 高德地图 MCP 服务（通过 HTTP Streamable 协议）
    "amap-maps-streamableHTTP": {
      url: "https://mcp.amap.com/mcp?key=" + process.env.AMAP_MAPS_API_KEY
    },
    // 文件系统 MCP 服务（操作本地文件）
    filesystem: {
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        ...(process.env.ALLOWED_PATHS.split(",") || [])
      ]
    },
    // Chrome DevTools MCP 服务（浏览器自动化）
    "chrome-devtools": {
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@latest"]
    }
  }
});

// ========== 3. 获取所有工具并绑定到模型 ==========
const tools = await mcpClient.getTools();
const modelWithTools = model.bindTools(tools);

// ========== 4. Agent 循环：思考 → 调用工具 → 观察结果 → 再思考 ==========
async function runAgentWithTools(query, maxIterations = 30) {
  const messages = [new HumanMessage(query)];

  for (let i = 0; i < maxIterations; i++) {
    console.log(chalk.bgGreen(`⏳ 正在等待 AI 思考...`));
    // 调用模型（可能返回文本或 tool_calls）
    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    // 如果没有工具调用，说明模型给出了最终答案
    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`\n✨ AI 最终回复:\n${response.content}\n`);
      return response.content;
    }

    // 有工具调用，执行它们
    console.log(
      chalk.bgBlue(`🔍 检测到 ${response.tool_calls.length} 个工具调用`)
    );
    console.log(
      chalk.bgBlue(
        `🔍 工具调用: ${response.tool_calls.map((t) => t.name).join(", ")}`
      )
    );
    // 逐个执行工具调用
    for (const toolCall of response.tool_calls) {
      const foundTool = tools.find((t) => t.name === toolCall.name);
      if (foundTool) {
        const toolResult = await foundTool.invoke(toolCall.args);

        // 确保 content 是字符串类型（兼容不同工具的返回值格式）
        let contentStr;
        if (typeof toolResult === "string") {
          contentStr = toolResult;
        } else if (toolResult && toolResult.text) {
          // 如果返回对象有 text 字段，优先使用
          contentStr = toolResult.text;
        }

        messages.push(
          new ToolMessage({
            content: contentStr,
            tool_call_id: toolCall.id
          })
        );
      }
    }
  }

  // 达到最大迭代次数，返回最后一条消息
  return messages[messages.length - 1].content;
}

// ========== 5. 执行任务 ==========
// 综合任务：搜索酒店 → 获取图片 → 打开浏览器展示 → 保存到本地文件
// await runAgentWithTools("北京南站附近的5个酒店，以及去的路线");
// await runAgentWithTools("北京南站附近的5个酒店，以及去的路线，路线规划生成文档保存到 /Users/guang/Desktop 的一个 md 文件");
await runAgentWithTools(
  "北京南站附近的酒店，最近的 3 个酒店，拿到酒店图片，打开浏览器，展示每个酒店的图片，每个 tab 一个 url 展示，并且在把那个页面标题改为酒店名" +
    "并且把酒店的详细信息（酒店名、酒店图片、地址、电话、评分、价格）用md格式保存到当前目录下的result文件夹中。"
);

// await mcpClient.close();
