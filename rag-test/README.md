# rag-test

LangChain **RAG（检索增强生成）入门**测试项目，从最简单的内存向量库问答，到文档加载与切分、真实网页 RAG 全链路，逐步进阶。

## 项目结构

```
rag-test/
└── src/
    ├── hello-rag.mjs            # 入门：内存向量库（MemoryVectorStore）RAG 问答
    ├── loader-and-splitter.mjs  # 文档加载与切分：Loader + TextSplitter 组合
    └── loader-and-splitter2.mjs # 进阶：真实网页加载 + 完整 RAG 链路
```

| 文件 | 核心内容 |
| --- | --- |
| `hello-rag.mjs` | 手写「光光和东东」友谊故事文档 → 向量化入内存库 → 检索 → LLM 生成回答 |
| `loader-and-splitter.mjs` | 演示各类 Loader（网页/文本等）与文本切分器的用法 |
| `loader-and-splitter2.mjs` | 从真实网页抓取内容，切块向量化后做 RAG 问答 |

## 快速开始

### 1. 前置依赖

- Node.js 18+
- 可访问的 OpenAI 兼容模型端点

### 2. 环境配置

项目使用 `dotenv` 加载 `.env`（参考 `.env.example` 缺失时的通用配置）：

```bash
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen-plus
EMBEDDINGS_MODEL_NAME=text-embedding-v3
```

### 3. 安装与运行

```bash
npm install   # 或 pnpm install

node src/hello-rag.mjs
node src/loader-and-splitter.mjs
node src/loader-and-splitter2.mjs
```

## 依赖

- `@langchain/classic` — MemoryVectorStore 等经典组件
- `@langchain/community` — 文档加载器
- `@langchain/textsplitters` — 文本切分
- `@langchain/openai` — 模型与嵌入
- `cheerio` — 网页解析
