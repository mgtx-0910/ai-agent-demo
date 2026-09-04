# pgsql-test — PostgreSQL + pgvector 语义检索

一个「聊天 + RAG 向量检索」的最小演示项目：用 PostgreSQL（pgvector 扩展）替代传统独立向量数据库，在关系库里同时完成业务数据存储与语义检索。

数据模型模拟真实聊天应用的三级结构：**用户（users）→ 会话（conversations）→ 消息（messages）**。消息内容可选附带 AI 生成的 embedding 向量，并借助 pgvector 的 **hnsw 索引 + 余弦距离**实现语义相似度搜索。

## 功能特性

- 用户 / 会话 / 消息三层 CRUD，外键级联删除
- 消息 `role` 字段约束为 `user / assistant / system`
- 写入、更新消息时可自动向量化（LangChain `OpenAIEmbeddings`）
- 语义相似度检索：`1 - (embedding <=> query)` 余弦相似度 + HNSW 索引加速
- `docker compose` 一键拉起 PostgreSQL(pgvector) 与 pgAdmin 图形化管理工具
- Docker 首次启动自动执行建表脚本，无需手动初始化

## 技术栈

| 类别 | 选型 |
| ---- | ---- |
| 运行时 | Node.js、npm |
| 数据库 | pgvector/pgvector:pg16（PostgreSQL 16 + pgvector 扩展） |
| 数据库驱动 | `pg`（连接池 Pool + 参数化查询） |
| Embedding | LangChain.js `@langchain/openai`（OpenAI 兼容接口） |
| 容器编排 | Docker Compose |

## 目录结构

```
pgsql-test/
├── docker-compose.yml      # PostgreSQL(pgvector) + pgAdmin 编排
├── init-scripts/
│   └── create_tables.sql   # 建表脚本（docker 首次启动自动执行）
├── create_tables.sql       # 与 init-scripts 同内容，供手动执行 / 参考
├── package.json
└── src/
    ├── db.mjs              # 数据库连接池与 query() 封装
    ├── users.mjs           # users 表 CRUD
    ├── conversations.mjs   # conversations 表 CRUD
    ├── messages.mjs        # messages CRUD + 向量写入 + 语义检索（核心）
    └── index.mjs           # 演示入口：端到端跑一遍全部能力
```

## 快速开始

### 1. 启动数据库

```bash
docker compose up -d
```

- 容器：`postgres`（pgvector/pgvector:pg16），端口 `5432`
- 默认账号：`user` / `123456`，数据库：`hello_pg`
- 首次启动会自动执行 `init-scripts/create_tables.sql` 完成建表
- pgAdmin 管理端：http://localhost:8088 （`admin@admin.com` / `admin`）

> 数据持久化在 `volumes/postgres` 与 `volumes/pgadmin`（挂载到项目目录下）。
> 如容器已存在旧数据卷，需 `docker compose down -v` 清理后再重建才会重新执行建表脚本。

### 2. 配置环境变量

在项目根目录创建 `.env`（参考下表字段）：

```bash
# 数据库连接串（与 docker-compose.yml 的账号/库名对应）
DATABASE_URL=postgres://user:123456@localhost:5432/hello_pg

# Embedding 模型的 API Key
OPENAI_API_KEY=sk-xxx

# OpenAI 兼容网关地址（如通义千问 DashScope、智谱等；省略则直连 OpenAI）
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# Embedding 模型，输出维度需与建表 SQL 的 vector(1024) 一致
EMBEDDING_MODEL=text-embedding-v3
```

| 变量 | 必填 | 说明 |
| ---- | ---- | ---- |
| `DATABASE_URL` | 是 | PostgreSQL 连接串 |
| `OPENAI_API_KEY` | 是 | Embedding 服务密钥 |
| `OPENAI_BASE_URL` | 否 | OpenAI 兼容网关，未配置则走官方地址 |
| `EMBEDDING_MODEL` | 否 | 默认 `text-embedding-v3`（1024 维） |

### 3. 安装依赖并运行

```bash
npm install
npm start
```

正常输出依次演示：用户 CRUD → 会话 CRUD → 消息 CRUD → 语义检索结果。

## 数据模型

```
users ──< conversations ──< messages
```

| 表 | 字段 | 说明 |
| -- | ---- | ---- |
| `users` | `id` / `name` / `created_at` | 用户 |
| `conversations` | `id` / `user_id` / `title` / `created_at` | 会话，`user_id` 外键→users，删除用户级联删除会话 |
| `messages` | `id` / `conversation_id` / `role` / `content` / `embedding` / `created_at` | 消息，`role` 有 CHECK 约束；`embedding` 为 `vector(1024)`，可为空 |

- `embedding` 列类型来自 pgvector 扩展：`CREATE EXTENSION IF NOT EXISTS vector;`
- 向量索引：`USING hnsw (embedding vector_cosine_ops)`，专为余弦相似度检索加速

## 语义检索原理

`src/messages.mjs` 的 `searchSimilarMessages()`：

1. 用与写入时相同的 embedding 模型把查询文本向量化；
2. 计算查询向量与库内消息向量的**余弦距离**（pgvector 运算符 `<=>`）；
3. 按距离升序取前 N 条，输出 `similarity = 1 - 距离`（0~1，越大越相似）。

```sql
SELECT id, role, content, 1 - (embedding <=> $1::vector) AS similarity
FROM messages
WHERE conversation_id = $2 AND embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT $3;
```

因为检索发生在向量空间而非关键词层面，输入「向量相似度怎么查」也能命中内容为「cosine 距离运算符 <=>」的消息，这正是 RAG 场景的基础能力。

## 手动建表

若未使用 docker 自动初始化（例如直连已有实例），可手动执行：

```bash
psql "postgres://user:123456@localhost:5432/hello_pg" -f create_tables.sql
```

## 相关项目

- [milvus-test](../milvus-test/)：使用独立向量数据库 Milvus 的方案，可与本项目的「关系库内嵌向量」方案对照
- [rag-test](../rag-test/)：内存向量库 + 完整 RAG 流程的入门实验
