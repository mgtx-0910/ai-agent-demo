# AI Agent 全栈开发学习

基于 [LangChain](https://www.langchain.com/) 的 AI Agent 开发学习项目，涵盖从基础组件到工业级流水线的完整实战。

> [📖 第一阶段学习总结](docs/LangChain-AI-Agent-第一阶段学习总结.md)

---

## 项目结构

```js
├── docs/                        # 📚 学习文档
│   └── LangChain-AI-Agent-第一阶段学习总结.md
├── tool-test/                   # 🔧 Tool & MCP — 工具定义与 Agent 循环
├── rag-test/                    # 🔍 RAG — 检索增强生成  
├── milvus-test/                 # 🗄️ Milvus — 向量数据库实战      
├── memory-test/                 # 🧠 Memory — 对话记忆管理
├── output-parser-test/          # 📤 OutputParser — 结构化输出控制   
├── prompt-template-test/        # 🏷️ PromptTemplate — 模块化 Prompt 管理
├── runnable-test/               # ⛓️ LCEL — Runnable 声明式编排
```

## 各子项目介绍（按创建时间线）

### 1. tool-test — Tool & MCP 

让大模型能调用工具，这是 Agent 的核心能力。

- **bindTools** — 定义工具 Schema 绑定到大模型
- **mini-cursor** — Agent 循环：tool_calls → 执行 → ToolMessage 反馈
- **MCP 集成** — 通过 `@langchain/mcp-adapters` 连接 MCP Server（高德地图 / Chrome Devtools / 文件系统）
- **自定义 MCP Server** — 手写 MCP Server 实现

### 2. rag-test — RAG

Agent 需要外部知识，RAG 给大模型装上"记忆外挂"。

- **Document Loader + Splitter** — 文档加载与分割
- **Embedding 向量化** — 文本转向量
- **MemoryVectorStore** — 向量存储与余弦相似度检索
- **电子书阅读助手** — 检索片段 → 大模型生成回答的完整 RAG 流程

### 3. milvus-test — Milvus

从内存向量库升级到生产级向量数据库。

- 连接 Milvus、创建 Collection、插入向量
- 语义相似度检索
- Milvus 原生 SDK (`@zilliz/milvus2-sdk-node`) 使用

### 4. memory-test — Memory

Agent 聊多了会超出上下文窗口，需要记忆管理。

- **InMemoryChatMessageHistory** — 内存存储
- **FileSystemChatMessageHistory** — 文件持久化
- **三大策略** — 截断（trim）/ 总结（summarize）/ 检索（retrieve）

### 5. output-parser-test — OutputParser

控制大模型的结构化输出，让返回结果可编程。

- **withStructuredOutput** — Zod Schema 一键结构化输出（支持流式）
- **JsonOutputToolsParser** — Tool Call 流式增量解析（mini cursor 实战）
- **StructuredOutputParser / XMLOutputParser** — 多种格式解析
- **smart-import** — 实战：AI 智能数据录入

### 6. prompt-template-test — PromptTemplate

Prompt 复杂到一定程度就需要组件化管理。

- **ChatPromptTemplate** — 区分 system / human 角色的消息模板
- **PipelinePromptTemplate** — 多个 PromptTemplate 模块化组合
- **FewShotPromptTemplate** — 少样本示例注入
- **ExampleSelector** — 按长度 / 语义相似度智能选择示例
- **MessagesPlaceholder** — 对话记录动态注入

### 7. runnable-test — LCEL Runnable

把前面所有组件用声明式链串起来，形成工业化流水线。

- **before / runnable** — 对照手写调用 vs LCEL 声明式链
- **12 种 Runnable API** — Sequence / Map / Branch / Lambda / Passthrough 等
- **综合案例** — 多节点组合实战

---

## 学习时间线

```
Tool & MCP         RAG           Milvus      Memory      OutputParser    PromptTemplate    LCEL
   │                │              │           │              │               │            │
 06-27            06-30          07-10       07-15          07-17           07-21        07-22
   │                │              │           │              │               │            │
   └─ Agent 行动     └─ 知识增强    └─ 向量DB   └─ 上下文管理  └─ 输出控制    └─ 输入控制     └─ 工业化编排
```

学完组件 → **工具集**，学完 LCEL → **工业流水线**。

---

## 技术栈

- **Runtime**: Node.js 24+
- **框架**: LangChain.js (`@langchain/core`, `@langchain/openai`, `@langchain/community`)
- **向量数据库**: Milvus
- **Schema**: Zod
- **包管理**: npm
