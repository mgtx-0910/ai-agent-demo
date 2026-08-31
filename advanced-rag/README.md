# Advanced RAG

基于 **LangChain.js + LangGraph** 的进阶 RAG（检索增强生成）示例集合，用《天龙八部》小说作为测试数据，从最简单的「检索 → 生成」一路进阶到「多跳推理」「联网回退」等生产级 RAG 架构。

## 项目简介

本项目通过 4 个渐进式示例，演示 RAG 系统如何一步步变「聪明」：

| 示例 | 核心能力 | 解决的痛点 |
| --- | --- | --- |
| `naive-rag` | 基础检索 + 生成 | 理解 RAG 最朴素的流程 |
| `rag-query-router` | 查询路由 | 简单问题也去检索，浪费算力与延迟 |
| `rag-multihop` | 多跳 / 问题拆解 | 复合问题一次检索答不全 |
| `rag-webfallback` | 本地检索 + 联网回退 | 本地知识库查不到 / 查不全 |

所有示例都基于 **LangGraph 状态图** 构建，每个示例都会打印出 Mermaid 图结构，方便直观理解节点与边的流转。

## 项目结构

```
advanced-rag/
├── src/
│   ├── naive-rag.mjs          # 朴素 RAG：检索 → 生成
│   ├── rag-query-router.mjs   # 查询路由器：direct / retrieve 分流
│   ├── rag-multihop.mjs       # 多跳 RAG：拆解 → 循环检索 → 综合生成
│   └── rag-webfallback.mjs    # 联网回退：本地不足时调用博查搜索补充
├── .env.example               # 环境变量示例
└── package.json
```

## 前置依赖

1. **Node.js 18+**（示例中使用了内置 `fetch`）
2. **Milvus 向量数据库**（默认 `localhost:19530`），集合 `ebook_collection` 中需已存在《天龙八部》分章切块后的向量数据
3. **兼容 OpenAI 协议的模型服务**（如阿里百炼、DeepSeek 等），用于生成与路由决策
4. **嵌入模型**：`text-embedding-v3`，维度 1024（须与 Milvus 建集合时的维度一致）

## 环境配置

复制 `.env.example` 为 `.env` 并填写：

```bash
OPENAI_API_KEY=sk-xxx                 # 模型服务 API Key
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen-plus                  # 生成/路由/评估模型
BOCHA_API_KEY=sk-xxx                  # 仅 rag-webfallback 需要（博查搜索）
```

## 运行

```bash
# 安装依赖
npm install

# 各示例分别运行
node src/naive-rag.mjs
node src/rag-query-router.mjs
node src/rag-multihop.mjs
node src/rag-webfallback.mjs
```

运行时会依次输出：Mermaid 图结构 → 连接 Milvus 日志 → 检索片段详情（相似度/章节）→ 流式 AI 回答。

## 示例详解

### 1. naive-rag —— 朴素 RAG

最基础的 RAG 流程：`START → retrieve → generate → END`，两条边直线走完，没有路由、没有评估、没有联网回退。

- 检索节点用 `similaritySearchWithScore` 从 Milvus 取回 Top-K 相似片段
- 生成节点把片段拼成带章节信息的上下文，流式输出基于事实的回答
- 适合作为理解 RAG 与 LangGraph `StateGraph` 机制的起点

### 2. rag-query-router —— 查询路由器

在朴素 RAG 上引入**路由决策**：先用 LLM 判断问题复杂度，简单问题（常识/概述）直接回答不检索，省时省钱；复杂问题（具体情节细节）才走完整 RAG 链路。

```
START → route ──(direct)──→ direct_answer → END
             └──(retrieve)──→ retrieve → rag_generate → END
```

- 使用 `withStructuredOutput` 让模型返回固定 JSON 结构
- 通过 `message_history` 字段支持多轮对话上下文

### 3. rag-multihop —— 多跳 RAG（Plan & Execute）

解决「一次检索答不了」的复合问题：先把复杂问题拆解为多个子问题，逐轮检索，由**规划器**判断信息是否足够，不足则生成新的子查询继续检索（图内循环），最后综合所有片段回答。

```
START → route ──(direct)──→ direct_answer → END
             └──(decompose)──→ decompose → retrieve → plan ──(信息不足)──→ retrieve(循环)
                                                          └──(足够/超限)──→ generate → END
```

- **问题拆解**：`decompose` 节点把复合问题拆成独立子问题
- **规划器**：`plan` 节点基于已检索片段判断下一步，支持图内循环
- **去重合并**：`mergeUnique` 避免重复片段挤占上下文
- **循环兜底**：`MAX_HOPS` 上限防止死循环

### 4. rag-webfallback —— 本地检索 + 联网回退

解决「本地知识库查不到 / 查不全」：先查本地 Milvus，用 LLM **评估**结果是否足够；不足时自动调用**博查搜索 API** 联网补充，二次评估后综合本地 + 网络信息生成回答。

```
START → route ──(direct)──→ direct_answer → END
             └──(retrieve)──→ retrieve_local → evaluate ──(足够)──→ generate → END
                                                    └──(不足)──→ web_search → evaluate_web → generate → END
```

- **评估器**：结构化输出 `sufficient` / `reason` / `search_queries`，驱动联网回退
- **裸调 HTTP API**：用内置 `fetch` 直连博查搜索，不依赖 LangChain 第三方集成
- **三级递进**：直接回答 → 本地检索 → 联网补充

## 技术要点

- **LangGraph 状态机制**：`invoke()` 传入的是「起点黑板」，节点返回的是「增量更新」，框架自动合并，三者共享同一套字段结构
- **条件边**：`addConditionalEdges(起点, 路由函数, [候选节点])` 是路由、循环、回退等所有分支逻辑的基础
- **结构化输出**：`withStructuredOutput(Schema)` 让模型严格按 JSON Schema 返回，供路由/评估/规划节点使用
- **状态白名单制**：节点返回的字段若未在 `GraphState` 中声明会被静默丢弃，新增状态字段时必须同步声明

## 依赖

- `@langchain/openai` — OpenAI 兼容模型与嵌入
- `@langchain/langgraph` — 状态图编排
- `@langchain/community` — Milvus 向量库集成
- `@zilliz/milvus2-sdk-node` — Milvus 客户端
- `dotenv` — 环境变量加载
- `zod` — 数据校验
