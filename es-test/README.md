# es-test

**Elasticsearch + Milvus + RAG 混合检索** 教学演示项目。先搭建 ES（IK 中文分词）与 Milvus 双存储环境，再演示从基础索引操作到「多路召回 + 重排 + 生成」的完整混合检索链路。

## 功能特性

- **双存储环境**：docker-compose 一键部署 Elasticsearch 8.17（内置 IK 中文分词）+ Kibana + Milvus 2.5 向量库
- **ES 基础操作**：索引管理、文档增删改查、全文检索（`match`/`term`）、IK 分词
- **混合检索 RAG**：用 LangGraph 编排「查询扩展 → ES ∥ Milvus 双路召回 → 合并去重 → Rerank → LLM 作答」全流程
- **自定义 Reranker**：基于 DashScope 文本排序接口实现 LangChain 文档压缩器

## 项目结构

```
es-test/
├── docker-compose.yml            # ES + Kibana + Milvus 环境编排
├── .env.example                  # 环境变量示例
├── es-test.md / es-test2.md / es-test3.md   # ES 操作速查文档
└── src/
    ├── create.mjs                # 初始化 ES 索引 + 写入旅行日记示例数据（幂等可重跑）
    ├── operate.mjs               # ES 文档 CRUD 与全文检索演示
    ├── rag/
    │   ├── seed-data.mjs         # 生活笔记种子数据：同时写入 ES（IK 全文索引）与 Milvus（HNSW）
    │   ├── query-augment.mjs     # LLM 查询扩展：问题改写成 3 条检索问句（zod + 失败兜底）
    │   └── hybrid-retrieval.mjs  # 核心：LangGraph 混合检索全链路
    └── rerank/
        ├── dashscope-rerank.mjs  # 自定义 DashScope 重排器（BaseDocumentCompressor）
        └── test.mjs              # 独立测试：3 条文档验证重排效果
```

## 混合检索流程

```
用户问题
   │
   ▼
查询扩展（LLM 改写为 3 条检索问句）
   │
   ├──▶ ES 关键词召回（IK 分词全文检索）
   │
   └──▶ Milvus 向量召回（语义相似度）
            │
            ▼
     合并去重（双路结果）
            │
            ▼
     Rerank 重排（DashScope 语义排序，压缩到 topN）
            │
            ▼
     LLM 生成最终回答
```

## 快速开始

### 1. 启动环境

```bash
docker-compose up -d
```

启动 Elasticsearch（9200）、Kibana（5601）、Milvus（19530）等服务。

### 2. 环境配置

```bash
cp .env.example .env
```

| 变量 | 说明 |
|---|---|
| `OPENAI_API_KEY` | 模型 API 密钥 |
| `OPENAI_BASE_URL` | OpenAI 兼容端点 |
| `MODEL_NAME` | 生成/查询扩展模型（如 `qwen-plus`） |
| `RERANK_URL` | DashScope 文本排序接口地址 |
| `RERANK_MODEL` | 重排模型（如 `qwen3-rerank`） |

### 3. 安装与运行

```bash
npm install

# ES 基础操作
node src/create.mjs        # 建索引 + 写入示例数据
node src/operate.mjs       # CRUD 与全文检索

# 混合检索 RAG（按顺序执行）
node src/rag/seed-data.mjs              # 双写种子数据
node src/rag/query-augment.mjs          # 查询扩展测试
node src/rag/hybrid-retrieval.mjs       # 完整混合检索

# 重排器测试（无需 ES/Milvus）
node src/rerank/test.mjs
```

## 文档参考

- `es-test.md` — ES 索引与文档增删改查操作速查
- `es-test2.md` / `es-test3.md` — 进阶检索场景
