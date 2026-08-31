# tool-test

LangChain **工具调用（Tool Calling）与 MCP（Model Context Protocol）** 测试项目，演示如何让 LLM 通过自然语言自动调度本地自定义工具及多个外部 MCP 服务，并模拟 Cursor 类 IDE 的自动化编码能力。

## 项目结构

```
tool-test/
├── result/                         # 工具执行产物（如自动化生成的项目）
└── src/
    ├── hello-langchain.mjs        # 最简 LangChain 入门：初始化 ChatOpenAI 直接问答
    ├── tool-file-read.mjs         # 最小 Tool Calling：LLM 自主调用 read_file 工具
    ├── all-tools.mjs              # 定义 4 个自定义工具（read_file/write_file/execute_command/list_directory）
    ├── my-mcp-server.mjs          # 自建 MCP 服务器（query_user 工具 + 使用指南资源）
    ├── langchain-mcp-test.mjs     # LangChain 连接单个 MCP 服务器做 Agent 式问答
    ├── mcp-test.mjs               # 同时连接多 MCP（自定义查询/高德地图/文件系统/Chrome DevTools）自动调度
    └── mini-cursor.mjs            # 模拟 Cursor：ReAct 循环自动化创建 React 应用
```

## 能力总览

| 文件 | 主题 | 说明 |
| --- | --- | --- |
| `tool-file-read.mjs` | Tool Calling 入门 | 模型按需调用 `read_file` 读取文件 |
| `all-tools.mjs` | 自定义工具集 | 文件读写 / 命令执行 / 目录列举 |
| `my-mcp-server.mjs` | MCP 服务器 | 基于 MCP 标准的本地服务端 |
| `langchain-mcp-test.mjs` | MCP 客户端 | 连接本地 MCP 服务器做问答 |
| `mcp-test.mjs` | 多 MCP 集成 | Agent 循环自动调度多个外部服务 |
| `mini-cursor.mjs` | 自动化 Agent | 模拟 Cursor 自动编码流程 |

## 快速开始

### 1. 前置依赖

- Node.js 18+
- 可访问的 OpenAI 兼容模型端点
- 相关 MCP 服务器（`mcp-test.mjs` 需要高德地图 / 文件系统 / Chrome DevTools 等 MCP 服务）

### 2. 环境配置

项目使用 `dotenv` 加载 `.env`：

```bash
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen-plus
```

### 3. 安装与运行

```bash
npm install

node src/hello-langchain.mjs
node src/tool-file-read.mjs
node src/all-tools.mjs
node src/my-mcp-server.mjs     # 先启动本地 MCP 服务器
node src/langchain-mcp-test.mjs
node src/mcp-test.mjs
node src/mini-cursor.mjs
```

## 依赖

- `@langchain/core` / `@langchain/openai` — 模型与工具框架
- `@langchain/mcp-adapters` — LangChain ↔ MCP 适配
- `@modelcontextprotocol/sdk` — MCP 协议实现
- `zod` / `chalk` — 校验与终端输出
