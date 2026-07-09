/**
 * my-mcp-server.mjs — 自定义 MCP 服务器
 *
 * 功能：基于 Model Context Protocol (MCP) 标准，创建一个提供用户查询服务的本地服务器
 *
 * MCP 概念：
 *   - Tool（工具）:  AI 模型可主动调用的功能（如 query_user）
 *   - Resource（资源）: 客户端可读取的被动数据（如 docs://guide 使用文档）
 *   - 通信方式: stdio（标准输入输出），通过 JSON-RPC 协议交互
 *
 * 使用场景：在 Cursor/CodeBuddy 等 MCP Client 中配置后，
 *           可通过自然语言对话自动调用本服务器的工具
 */

// MCP SDK：服务端核心 + stdio 传输层
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// 参数校验
import { z } from "zod";

// ========== 1. 模拟数据库 ==========
const database = {
  users: {
    "001": {
      id: "001",
      name: "张三",
      email: "zhangsan@example.com",
      role: "admin"
    },
    "002": { id: "002", name: "李四", email: "lisi@example.com", role: "user" },
    "003": {
      id: "003",
      name: "王五",
      email: "wangwu@example.com",
      role: "user"
    }
  }
};

// ========== 2. 创建 MCP 服务器实例 ==========
const server = new McpServer({
  name: "my-mcp-server",
  version: "1.0.0"
});

// ========== 3. 注册工具：查询用户信息 ==========
// 工具是 AI 可以主动调用的"函数"
server.registerTool(
  "query_user",
  {
    description:
      "查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。",
    // 用 Zod 定义输入参数的 schema（AI 会根据描述自动填充参数）
    inputSchema: {
      userId: z.string().describe("用户 ID，例如: 001, 002, 003")
    }
  },
  async ({ userId }) => {
    const user = database.users[userId];

    // 用户不存在
    if (!user) {
      return {
        content: [
          {
            type: "text",
            text: `用户 ID ${userId} 不存在。可用的 ID: 001, 002, 003`
          }
        ]
      };
    }

    // 返回用户信息（MCP 标准的 content 数组格式）
    return {
      content: [
        {
          type: "text",
          text: `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}\n- 角色: ${user.role}`
        }
      ]
    };
  }
);

// ========== 4. 注册资源：使用指南 ==========
// 资源是客户端可读取的"被动数据"（类似文件的概念）
server.registerResource(
  "使用指南",
  "docs://guide",             // 资源的唯一 URI 标识
  {
    description: "MCP Server 使用文档",
    mimeType: "text/plain"
  },
  async () => {
    return {
      contents: [
        {
          uri: "docs://guide",
          mimeType: "text/plain",
          text: `MCP Server 使用指南

功能：提供用户查询等工具。

使用：在 Cursor 等 MCP Client 中通过自然语言对话，Cursor 会自动调用相应工具。`
        }
      ]
    };
  }
);

// ========== 5. 启动服务器 ==========
// 通过 stdio 传输层连接，等待 MCP Client 通过 stdin/stdout 通信
const transport = new StdioServerTransport();
await server.connect(transport);
