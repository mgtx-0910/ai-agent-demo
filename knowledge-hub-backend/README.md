# Knowledge Hub — 企业知识库后端

把「文档 → 审核 → 检索 → 问答」完整串起来的企业知识库后端服务。

它解决的问题是：公司内部的制度、SOP、规范散落在 PDF / Word / Excel / PPT 里，人找不到、AI 也答不准。本项目把文件收进来、解析成 Markdown、按权限发布，再同时建立**全文索引 / 向量索引 / 知识图谱**三套检索能力，最后用 Agentic RAG 对外提供「问一句、给答案、附出处」的问答接口。

> 这是 `ai-agent-demo` 仓库中把前面学习成果（NestJS 工程化、RAG、ES 混合检索、Neo4j 图谱、Redis/Mem0 记忆、权限体系）组装到一起的综合项目。
>
> 🧭 **新手导学（HTML）**：[docs/html/knowledge-hub-guide.html](../docs/html/knowledge-hub-guide.html) — 前后端双项目 7 阶段上手路线，建议先看它再读本 README。
>
> ❓ **面试题收集（HTML）**：[docs/html/interview-questions.html](../docs/html/interview-questions.html) — 围绕本项目 RAG 检索与评测的问答，含参考答案与追问。
>
> 🎯 **面试强化训练（HTML）**：[docs/html/interview-training.html](../docs/html/interview-training.html) — 前端视角补后端：26 个训练单元（原理 + 本项目代码位置 + 动手练习 + 验收标准），配 14 天冲刺计划。

## 目录

- [一、这个项目做什么](#一这个项目做什么)
- [二、架构总览](#二架构总览)
- [三、快速开始](#三快速开始)
- [四、目录结构](#四目录结构)
- [五、核心设计](#五核心设计)
- [六、API 一览](#六api-一览)
- [七、数据模型](#七数据模型)
- [八、配置项](#八配置项)
- [九、手工验证](#九手工验证)
- [十、已知限制与后续](#十已知限制与后续)

---

## 一、这个项目做什么

### 一条端到端的故事

```
1. 作者上传 PDF / 图片 / Word / Excel / PPT / TXT → 后端经 MinerU 精准解析成 Markdown，写入草稿（状态：草稿）

2. 作者点「发布」
     ├─ 开启审核：状态变「待审核」并生成待办；审核员通过 → 「已发布」+ 异步建索引
     └─ 关闭审核：直接「已发布」+ 异步建索引

3. 任何人搜索 / 提问
     → 关键词 + 向量双路召回 → RRF 融合 → rerank 精排 → 大模型作答（附引用出处）

4. 作者改可见性（公开 / 团队可见）或归档
     → 三套索引同步更新或清理，不重跑 embedding
```

### 核心能力

| 能力 | 说明 |
|---|---|
| 文档管理 | 上传解析、Markdown 正文存储、元数据、软删除、归档/下架 |
| 文档互动 | 点赞 / 收藏 / 评论（两级）/ 分享链接（可选密码与有效期），互动写入站内通知 |
| 分类与版本 | 分类树维护（文档只能挂到启用的分类）；正文每次变更留版本快照，可回滚 |
| 站内通知 | 点赞 / 评论 / 系统广播三类通知，未读数与已读标记 |
| 发布审核 | 可开关的审核流程，每次提交与结论落 `kh_document_review` |
| 文件解析 | PDF / 图片 / DOC(X) / PPT(X) / XLS(X) 走 MinerU 精准解析（公式、表格、版式还原），TXT / MD 本地直读；解析出的图片落 RustFS |
| RAG 检索 | ES 关键词（IK 分词）+ 向量 kNN 双路 → RRF 融合 → rerank 精排 |
| AI 问答 | Agentic RAG：意图分类 → 检索 → 评估 → 改写重查 → 必要时联网 |
| 流式输出 | `/ai/chat/stream` SSE 逐块推送，带思考过程与引用来源 |
| 会话记忆 | 三层：Postgres 历史 + Redis 热窗口 + Mem0 长期记忆 |
| 知识图谱 | LLM 抽取实体关系 → Neo4j，提供图谱全景 / 搜索 / 节点 / 边接口 |
| 用户与权限 | JWT 双 token、RBAC 六表、菜单/按钮/接口三级权限码 |
| 数据可见性 | 同一套权限规则下推到 Postgres / ES / Neo4j 三处查询 |
| 异步管线 | RabbitMQ 三路队列：RAG 向量化 / 全文索引 / 图谱构建 |

---

## 二、架构总览

### 2.1 分层

```
                 ┌──────────────────────────┐
   HTTP 请求 ───► │ Controller 层             │  路由 + 权限码声明
                 │ documents / ai / search  │
                 └────────────┬─────────────┘
        ┌─────────────────────┼─────────────────────┐
   ┌────▼─────┐        ┌──────▼──────┐       ┌──────▼───────┐
   │ 业务服务  │        │  检索引擎    │       │   管线服务    │
   │ Document │        │  Hybrid      │       │  Chunking    │
   │ Review   │        │  Retrieval   │       │  Embedding   │
   │ Chat     │        │  Reranker    │       │  Vector/Search│
   │ Team/User│        │  Graph       │       │  Index/Graph │
   └────┬─────┘        └──────┬──────┘       └──────┬───────┘
        └─────────────────────┼─────────────────────┘
                    ┌─────────▼──────────┐
                    │ PipelineOrchestrator│  统一编排：加载文档 → 写索引
                    │ （MQ 消费者驱动）    │
                    └─────────┬──────────┘
   ┌──────────┬──────────┬────▼────────┬──────────┬─────────┐
   │PostgreSQL│ MongoDB  │Elasticsearch│  Neo4j   │  Redis  │
   │ 元数据    │ 正文     │ 检索索引     │  图谱     │ 缓存    │
   └──────────┴──────────┴─────────────┴──────────┴─────────┘
```

### 2.2 存储分工

每个存储只干它最擅长的事，这是本项目最重要的设计取舍：

| 组件 | 存什么 | 为什么是它 |
|---|---|---|
| **PostgreSQL** | 文档元数据、审核流水、用户/角色/权限、团队、AI 会话 | 需要事务、外键、条件分页查询的结构化数据 |
| **MongoDB** | 文档 Markdown 正文（`document_content`） | 长文本、无需 join、按 `document_id` 单点读写 |
| **Elasticsearch** | `kh_chunk`（分块 + 向量）、`kh_document`（文档级全文） | 中文分词（IK）+ kNN 向量检索 |
| **Neo4j** | 文档 / 块 / 实体节点与关系 | 「实体 A 与实体 B 什么关系」这类多跳问题 |
| **Redis** | 验证码、激活 token、对话短期记忆热窗口 | 短 TTL 的一次性数据与高频读写 |
| **RustFS (S3)** | MinerU 解析结果里的图片（`document-images` 前缀）、原文件 | 二进制对象不适合塞进数据库 |
| **RabbitMQ** | 发布后的三条索引流水线消息 | 建索引耗时长（embedding + LLM 抽取），必须异步 |

> Postgres 与 Mongo 是**两个独立库，没有跨库事务**。因此写正文采用「先写 Mongo → 再写 Postgres → 失败则补偿删除 Mongo」（见 `src/document/document.service.ts`）。

### 2.3 技术栈

| 分类 | 选型 |
|---|---|
| 运行时 | Node.js + TypeScript 5.7 |
| 框架 | NestJS 11（DI / Guard / Interceptor / Pipe） |
| ORM / ODM | TypeORM 0.3（Postgres）+ Mongoose 9（Mongo） |
| 检索 | `@elastic/elasticsearch` 8.17（IK 分词 + dense_vector） |
| 图数据库 | `neo4j-driver` 6 |
| 缓存 / 消息 | `ioredis` / `amqplib` + `amqp-connection-manager` |
| AI | LangChain（`@langchain/core`）+ `createAgent` + Vercel AI SDK 桥接 |
| 鉴权 | `@nestjs/jwt` + `passport-jwt` + `bcryptjs` |
| 文件解析 | MinerU 精准解析（`/api/v4/file-urls/batch` + 轮询）+ `jszip` 解包；仓库仍保留 `pdf-parse` / `mammoth` / `exceljs` / `officeparser` / `turndown` 的本地解析器实现 |
| 校验 | `class-validator` + `class-transformer` + `zod`（LLM 结构化输出） |
| ID 生成 | `snowflake-id`（全表 BIGINT 主键统一雪花 ID） |

---

## 三、快速开始

### 3.1 环境要求

- Node.js 20+、pnpm
- Docker / Docker Compose（基础设施全部容器化）

### 3.2 启动基础设施

```bash
cd knowledge-hub-backend
docker compose up -d
```

| 服务 | 端口 | 控制台 |
|---|---|---|
| PostgreSQL + pgvector | 5432 | pgAdmin http://localhost:8088 |
| MongoDB | 27017 | mongo-express http://localhost:8081 |
| Redis | 6379 | RedisInsight http://localhost:5540 |
| RabbitMQ | 5672 | Management UI http://localhost:15672 |
| Elasticsearch（含 IK） | 9200 | Kibana http://localhost:5601 |
| Neo4j | 7474 / 7687 | Neo4j Browser http://localhost:7474 |
| RustFS（S3 兼容） | 9000 / 9001 | Console http://localhost:9001 |

> ES 由 `elasticsearch/Dockerfile` 本地构建，把 IK 分词器烤进镜像（官方镜像不含插件），首次 `up` 会多花一两分钟构建。

### 3.3 配置环境变量

```bash
cp .env.example .env
```

至少补齐这几个，其余可留默认：

```bash
OPENAI_API_KEY=sk-xxx        # LLM（KG 抽取 / 问答），不配则抽取报错
MINERU_API_TOKEN=            # 文件解析，不配则上传 PDF/Office 直接报错
# EMBEDDING_API_KEY=         # 不配则降级为本地哈希向量，检索质量明显下降
# RERANK_API_KEY=            # 不配则跳过 rerank，直接返回 RRF 顺序
# BOCHA_API_KEY=             # 联网搜索，不配则 web_search 返回提示
# MEM0_API_KEY=              # 长期记忆，不配则整体跳过
```

> 解析 PDF / 图片 / Office 时必须同时启用 RustFS（`RUSTFS_ENABLED=true`），否则解析出的图片无处存放会直接报错；TXT / MD 不受影响。

### 3.4 启动应用

```bash
pnpm install
pnpm start:dev          # 开发模式（watch）
# pnpm build && pnpm start:prod   # 生产模式
```

### 3.5 验证与默认账号

```bash
curl http://localhost:3000/          # → Hello World!

curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"123456"}'
```

`init-scripts/postgresql/init.sql` 预置三个账号（**密码均为 `123456`**）：

| 账号 | 角色 | 用途 |
|---|---|---|
| `admin` | ROLE_ADMIN + ROLE_REVIEWER | 系统管理、全部权限 |
| `reviewer` | ROLE_REVIEWER | 文档审核 |
| `user` | ROLE_USER | 普通用户，可创建/编辑自己的文档 |

> 全局没有路由前缀，接口路径就是 `/auth/login`、`/documents`、`/ai/chat`（`src/main.ts` 未调用 `setGlobalPrefix`）。全局 `ValidationPipe` 开了 `whitelist + transform + forbidNonWhitelisted`，多传字段会直接报错。

### 3.6 重新初始化数据库

`init.sql` **只在数据卷第一次创建时执行**。已跑过 `docker compose up` 后改表需手动执行：

```bash
# 老库升级（保留数据）：补齐分类/互动/分享/版本/通知 7 张表与相应权限码，幂等可重复执行
docker exec -i knowledge_hub_postgres psql -U user -d knowledge_hub < init-scripts/postgresql/migrate-social-notification.sql

# 或彻底重建（会删掉数据）
docker compose down && rm -rf volumes/postgres && docker compose up -d
```

---

## 四、目录结构

```
knowledge-hub-backend/
├── elasticsearch/               # ES 自定义镜像（内置 IK 分词器）
├── init-scripts/postgresql/     # 建表 + 种子数据（19 张表）；migrate-social-notification.sql 给老库补新表
├── test-files/                  # 解析测试语料（文本版/扫描版 PDF、DOCX/XLSX/PPTX）+ RAG 评测集
├── docker-compose.yml           # 全部基础设施编排
├── curl-*.md                    # 各模块手工验证脚本（见第九节）
└── src/
    ├── main.ts                  # 启动引导：CORS + ValidationPipe + 启动/关闭 Langfuse tracing
    ├── app.module.ts            # 根模块：装配 19 个 TypeORM 实体与所有业务模块
    │
    ├── auth/                    # 认证与授权
    │   ├── auth.controller.ts   #   注册 / 登录 / 刷新 / 登出 / me
    │   ├── auth.service.ts      #   签发与校验 JWT 双 token
    │   ├── jwt.strategy.ts      #   token → AuthUser（角色 + 权限 + 团队）
    │   ├── jwt-auth.guard.ts    #   全局守卫 1：是否登录
    │   ├── roles.guard.ts       #   全局守卫 2：@Roles 角色校验
    │   ├── permissions.guard.ts #   全局守卫 3：@RequirePermission 权限码校验
    │   ├── email-activation.service.ts  # 邮箱激活凭证（Redis，24h）
    │   ├── password-reset.service.ts    # 重置验证码（Redis，10min）
    │   └── decorators/          #   @Public / @Roles / @RequirePermission / @CurrentUser
    │
    ├── user/                    # 用户与 RBAC
    │   ├── user|role|permission .controller.ts / .service.ts
    │   ├── entities/            #   用户/角色/权限/用户角色/角色权限/用户权限 六张表
    │   └── vo/user.vo.ts        #   对外返回结构（不含密码等敏感字段）
    │
    ├── team/                    # 团队（树形）与成员
    │   └── team.service.ts      #   含 listAccessibleTeamIds：数据可见性的输入
    │
    ├── document/                # 文档领域
    │   ├── document.controller.ts     # 文档 CRUD + 发布/归档/下架
    │   ├── document.service.ts        # 核心业务：状态流转 + 跨库写入 + 补偿
    │   ├── document-review.service.ts # 提交审核 / 通过 / 驳回 / 待办列表
    │   ├── document-status.ts         # 状态机与流转规则（纯函数，好测）
    │   ├── document-access.ts         # ★ 可见性规则 + ES/Neo4j 条件构造器
    │   ├── document-engagement.controller.ts # 点赞/收藏/评论/分享/版本（含 /favorites）
    │   ├── document-social.service.ts # 点赞、收藏、评论、收藏列表
    │   ├── document-share.service.ts  # 分享链接创建/校验/访问（对外 /shares/:code）
    │   ├── document-version.service.ts# 正文版本快照与回滚
    │   ├── share.controller.ts        # 公开分享访问（@Public）
    │   ├── category.controller.ts     # 分类树与维护
    │   ├── category.service.ts        # 分类 CRUD、启用校验、id → 名称
    │   ├── entities/                  # kh_document / review / category / comment
    │   │                              # / like / favorite / share / version
    │   ├── schemas/                   # Mongo 正文 schema
    │   └── parser/                    # 文件 → Markdown（按扩展名分发）
    │
    ├── notification/            # 站内通知
    │   ├── notification.controller.ts # 列表 / 未读数 / 已读 / 全部已读 / 广播
    │   ├── notification.service.ts    # 写入通知（点赞、评论、系统广播）
    │   └── notification.entity.ts     # kh_notification
    │
    ├── pipeline/                # 索引构建管线
    │   ├── pipeline.orchestrator.ts   # ★ MQ 处理入口：加载文档 → 调索引服务
    │   ├── chunking.service.ts        # 分块（512/64，带标题前缀）
    │   ├── embedding.service.ts       # 批量向量化（无 Key 时本地哈希降级）
    │   ├── vector-index.service.ts    # ES kh_chunk：写入 / kNN / 关键词 / RRF / 可见性
    │   ├── search-index.service.ts    # ES kh_document：全文索引 / 高亮分页
    │   ├── graph-build.service.ts     # Neo4j：建图 / 查询 / 可见性更新
    │   ├── extraction.service.ts      # LLM 抽取实体与关系
    │   └── kg-extraction.schema.ts    # 实体/关系类型枚举 + 抽取 Prompt
    │
    ├── ai/                      # RAG 问答
    │   ├── ai.controller.ts           # /rag/search /ai/chat /ai/chat/stream /ai/sessions
    │   ├── ai-chat.service.ts         # 非流式问答
    │   ├── ai-stream.service.ts       # ★ 流式 Agent：createAgent + 4 工具 + 中间件
    │   ├── hybrid-retrieval.service.ts# 双路召回 → RRF → rerank 编排
    │   ├── reranker.service.ts        # qwen3-rerank 精排 + 阈值过滤
    │   ├── chat-query-rewrite.service.ts # 意图分类 / 追问改写 / 切题评估
    │   ├── chat-session.service.ts    # 会话与消息持久化（sources 存 JSONB）
    │   ├── chat-short-memory.service.ts # Redis 热窗口（miss 回填 Postgres）
    │   ├── chat-long-memory.service.ts  # Mem0 长期记忆（可选）
    │   ├── web-search.service.ts      # Bocha 联网搜索
    │   ├── agentic-retrieve.ts        # 检索结果切题评估
    │   └── eval/                      # ★ RAG 评测：金标集 + 评测器 + 跑分入口
    │       ├── golden-dataset.ts      #   9 条离线金标（routing / kb-hit / rewrite / kb-empty / web）
    │       ├── evaluators.ts          #   9 个评测器（意图 / 工具策略 / Hit@5 / 拒答 / 忠实度）
    │       ├── run-experiment.ts      #   pnpm eval:rag 入口，走线上同一条 Agent 链路
    │       └── eval.types.ts          #   快照 / 金标 / 分数类型
    │
    ├── search/                  # POST /search：文档级全文检索
    ├── graph/                   # /graph：图谱全景 / 搜索 / 节点 / 边
    ├── mq/                      # RabbitMQ 拓扑、连接管理、消费者与生产者
    │   ├── mq.constants.ts      #   3 个交换机 + 3 个队列 + 路由键
    │   ├── document-pipeline.consumer.ts  # 消费三路消息 → 转交 Orchestrator
    │   └── document-pipeline.publisher.ts # 发布时投递消息
    ├── storage/                 # RustFS（S3）对象存储
    ├── redis/                   # ioredis 全局模块
    ├── observability/           # ★ Langfuse tracing：OTel SDK 启动 + span 封装
    │   └── langfuse.ts          #   isLangfuseEnabled / withObservation / withTraceAttrs
    └── common/
        ├── constants/permissions.ts   # 权限码 + 管理员默认权限集
        ├── constants/roles.ts         # ROLE_ADMIN / ROLE_REVIEWER / ROLE_USER
        └── snowflake-id.ts            # 全局 ID 生成
```

---

## 五、核心设计

### 5.1 文档状态机

状态值对应 `kh_document.status`，规则集中在 `src/document/document-status.ts`（纯函数，便于单测）：

```
   ┌────────┐  发布   ┌───────────────┐  审核通过  ┌─────────────┐
   │ 草稿    │ ─────► │  待审核        │ ────────► │  已发布      │
   │ Draft 0│        │ PendingReview 3│           │ Published 1 │
   └───┬────┘        └───────┬───────┘           └──────┬──────┘
       │   ▲   驳回回到草稿    │                          │ 归档
       │   └──────────────────┘                          ▼
       │                                        ┌─────────────┐
       └────────── 下架编辑（回到草稿）──────────► │  已归档      │
                                                │ Archived 2  │
                                                └─────────────┘
```

关键约束：

| 规则 | 函数 | 说明 |
|---|---|---|
| 只有草稿/已发布/已归档可提交审核 | `canSubmitReview` | 已发布再提审会先清索引 |
| 待审核期间禁止改正文 | `canEditContent` | 防止「审的内容」与「发布的内容」不一致 |
| 只有已发布可归档 | `canArchive` | — |
| 是否走审核 | `DOCUMENT_REQUIRE_APPROVAL` | `true`（默认）：发布进待审；`false`：直接发布 |

### 5.2 发布后索引管线（异步三路）

发布是「写库 + 投递消息」的轻量动作，真正的索引构建由消费者异步完成：

```
DocumentService.publish()   （免审直接发布，或审核通过后）
        │
        ▼
DocumentPipelinePublisher ──► RabbitMQ
        │
        ├── rag.reindex.exchange  ──► kh.rag.reindex.queue
        │      RAG：清旧块 → 分块(512/64) → 批量 embedding → ES kh_chunk
        ├── search.index.exchange ──► kh.search.index.queue
        │      Search：只带 documentId → 消费者回查 PG + Mongo → ES kh_document
        └── kg.graph.exchange     ──► kh.kg.graph.queue
               KG：分块 → LLM 抽实体关系 → Neo4j
```

设计要点：

1. **Search 消息只携带 `documentId`**，不塞正文。正文在 Mongo，消费者自己回查，避免 MQ 里塞大文本。
2. **单篇失败不影响其它文档**：`PipelineOrchestrator` 逐篇 `try/catch` 并记日志。
3. **重建前先清旧块**（`deleteByDocId`），重复发布不产生脏数据。
4. **可见性变更走专用分支**（`updateVisibility`）：公开/团队变化只更新三套索引上的 `is_public` / `team_id`，**不重跑 embedding 与实体抽取**。
5. ES / Neo4j 不可用时由 `ELASTICSEARCH_ENABLED` / `NEO4J_ENABLED` 控制降级跳过，不阻塞主流程。

### 5.3 RAG 检索链路

`POST /rag/search`（纯检索，不调 LLM）与问答链路共用同一套召回：

```
query
  ├─► 关键词召回（ES kh_chunk）    ┌── 双路并行 ──┐   multi_match:
  │     document_title^2, content，analyzer ik_smart
  └─► 向量召回（ES kh_chunk kNN）                    1024 维 cosine
        │
        ▼
   RRF 融合（RAG_RRF_C=60）        每路各取 RAG_HYBRID_TOP_K=20
        │
        ▼
   rerank 精排（qwen3-rerank）→ 丢弃低于 RAG_MIN_SCORE=0.4 的块
        │
        ▼
   ChunkHit[]（chunkId / documentId / documentTitle / content / heading / score）
```

降级策略，保证「关键依赖挂了也能用」：

| 故障 | 行为 |
|---|---|
| Embedding Key 未配置 | 使用本地哈希向量 |
| 向量化失败 | 跳过向量路，退化为纯关键词检索 |
| Rerank 不可用或失败 | 直接返回 RRF 融合顺序 |

ES `kh_chunk` 的 mapping 由代码启动时自动创建；`document_id` 用 `keyword` 而非 long，避免雪花 ID 在 JS 中丢精度。

### 5.4 Agentic RAG 问答

`/ai/chat`（非流式）与 `/ai/chat/stream`（SSE）推理流程一致，核心在 `src/ai/ai-stream.service.ts`：

```
用户提问
  ▼
意图分类（chat-query-rewrite）→ 决定本轮开哪些工具、是否消解追问指代
  ▼
createAgent({ model, tools, systemPrompt, middleware })
  ├── retrieve_knowledge   检索知识库（仅当前用户可见文档）+ 切题评估
  ├── rewrite_query        评估不切题时改写检索词（最多再查一次）
  ├── retrieve_graph       检索图谱实体与关系（与上一工具首次并行调用）
  └── web_search           知识库不足时联网（Bocha）
  ├── summarizationMiddleware    消息超 12 条自动总结，压缩上下文
  └── modelCallLimitMiddleware   runLimit 8，达上限优雅结束
  ▼
流式输出：思考过程 + 正文 + 引用来源（sources）
```

刻意的行为约束：

- 知识库检索**本轮最多两次**，避免无限重试；
- 图谱结果只用于说明实体关系，**不能当制度原文**（写进工具描述）；
- 联网只在知识库循环结束后仍不足时触发，**不允许用网页替代已切题的内部资料**；
- 检索一律带上当前用户的可见性范围（见 5.6）。

### 5.5 三层对话记忆

| 层 | 存储 | 作用 | 失效行为 |
|---|---|---|---|
| 会话历史 | Postgres `kh_ai_session` / `kh_ai_message` | 权威存储，`sources` 用 JSONB 存引用 | 永久 |
| 短期热窗口 | Redis | 最近 N 条（`CHAT_SHORT_MEMORY_MAX_MESSAGES=20`） | TTL 后不丢历史，下次从 Postgres 回填 |
| 长期记忆 | Mem0（可选） | 跨会话的用户偏好类信息 | 未配 Key 则整体跳过 |

> 定位很明确：**记忆不是知识库**。用户偏好可以记住，制度条文必须以检索结果为准，不能让「记忆」覆盖「知识库」。

### 5.6 认证与权限

**认证**：JWT 双 token（access 2h / refresh 7d），密码 bcrypt 哈希存储。注册可开启邮箱激活（`REQUIRE_EMAIL_VERIFICATION`），激活 token 与重置验证码都放 Redis 且带 TTL。

**授权**：三个全局守卫按顺序执行（注册在 `src/auth/auth.module.ts`）：

```
请求 ──► JwtAuthGuard ──► RolesGuard ──► PermissionsGuard ──► Controller
        （是否登录）      （@Roles）      （@RequirePermission）
             └── 标了 @Public() 的接口跳过登录校验
```

权限是「角色权限 OR 直授权限」：

```
用户最终权限 = 直授权限 kh_user_permission
             OR （kh_user_role → kh_role_permission）
             （ADMIN 额外并入 ADMIN_OPERATION_PERMISSIONS）
```

角色只有三个：`ROLE_ADMIN` / `ROLE_REVIEWER` / `ROLE_USER`。权限码分三级（菜单 / 按钮 / 接口），如 `document:list`、`document:create`、`system:user`、`system:permission:edit`。

文档互动相关的几个新权限码：`document:category`（分类维护）、`document:category:query`（分类查询，有 `document:list` 也可读树）、`document:version`（版本列表与回滚）。分类与版本接口用 `@RequirePermission` 传多个码时是 **OR** 关系，即「有任一码即可」。

**数据可见性**是本项目较有含金量的一块：规则只写一次（`src/document/document-access.ts`），再**下推到三个存储各自的查询语句**：

```
可读 = 管理员/审核员（unrestricted）
     OR 文档作者是自己
     OR （已发布 AND（文档公开 OR 文档 team_id IN 我的团队集合））

可写 = 管理员 OR 文档作者
```

| 存储 | 下推方式 |
|---|---|
| Postgres | QueryBuilder 拼接可见性条件（列表 / 详情） |
| Elasticsearch | `esVisibilityFilter()` 生成 `bool.should + minimum_should_match:1`，再由 `wrapEsQuery()` 把**相关性放 must、权限放 filter**，保证权限条件不影响打分 |
| Neo4j | `neo4jDocumentAccessWhere()` 生成 Cypher 条件 + `neo4jAccessParams()` 传参，图谱查询同样只返回可见文档抽出的节点 |

`teamIds` 来自 `TeamService.listAccessibleTeamIds()`（我所属的团队 + 我负责的团队），登录时随 `AuthUser` 一起放进请求上下文，避免每次查询都回表。

### 5.7 文件解析与对象存储

上传接口用 `FileInterceptor` 接收（限 200MB，与 MinerU 单文件上限一致），`src/document/parser/file-parser.service.ts` 按扩展名分流：

| 类型 | 处理方式 |
|---|---|
| PDF / 图片（png/jpg/jp2/webp/gif/bmp）/ DOC(X) / PPT(X) / XLS(X) | 走 MinerU 精准解析（`mineru.parser.ts`） |
| TXT / MD | 本地按 UTF-8 直读（`plain-text.parser.ts`） |

MinerU 链路（`src/document/parser/mineru.parser.ts`）四步：

```
POST /api/v4/file-urls/batch          申请上传链接（带 model_version / language / 公式 / 表格开关）
        │  PUT 到签名 URL（不能带 Content-Type，否则签名链接可能被拒）
        ▼
GET /api/v4/extract-results/batch/:batchId   轮询 state（waiting → running → done / failed）
        │  done 时取 full_zip_url
        ▼
下载 zip → jszip 取 full.md → images/ 逐张上传 RustFS（document-images 前缀）
        │  按相对路径把 Markdown 里的 images/xxx 替换成对象存储地址
        ▼
cleanMarkdown() 清洗后写入 Mongo
```

几个关键点：

- **必须配 `MINERU_API_TOKEN`**，否则上传解析直接抛 `未配置 MINERU_API_TOKEN，无法解析文件`；token 在 https://mineru.net/apiManage/token 创建。
- **有图就必须启用 RustFS**：解析结果含图片而 `RUSTFS_ENABLED=false` 时会直接报错，而不是返回一批失效的相对路径。
- **图片与扫描件自动 OCR**：图片类扩展名会带 `is_ocr: true`，扫描版 PDF 也能抽出文字。
- **轮询参数可调**：`MINERU_POLL_INTERVAL_MS`（默认 3000）、`MINERU_POLL_TIMEOUT_MS`（默认 600000 即 10 分钟）；轮询请求 30s 超时、上传与下载各 120s 超时，超时统一抛 `BadRequestException`。
- 格式不支持、内容为空、MinerU 返回 `failed` 都会转成 `BadRequestException`，前端能直接展示可读的错误文案。

解析结果是 Markdown，写入 Mongo；同时把标题、分类、团队、是否公开等元数据写入 Postgres。原有的本地解析器（`parsers/pdf.parser.ts`、`docx.parser.ts`、`pptx.parser.ts`、`xlsx.parser.ts`）已不再被 `file-parser.service.ts` 引用，保留作为离线/降级参考实现。

### 5.8 可观测性（Langfuse tracing）

一条 Agentic RAG 链路里藏着 5 次模型调用（意图分类 → 检索 → 切题评估 → 重写 → 生成），出问题时只看日志很难还原「哪一步慢了、哪一步判错了」。所以接入了 Langfuse：

- **接入方式是 OpenTelemetry**：`src/observability/langfuse.ts` 用 `NodeSDK + LangfuseSpanProcessor` 组装 SDK，`main.ts` 启动时 `startLangfuseTracing()`，`process.once('beforeExit')` 时 flush 关闭。
- **不配 Key 就整体空转**：`isLangfuseEnabled()` 要求 `LANGFUSE_PUBLIC_KEY` 与 `LANGFUSE_SECRET_KEY` 同时存在，否则 `withObservation()` 直接原样执行（`run(() => undefined)`），业务代码里没有一处 `if (enabled)` 分支。

上报的 span（`withObservation(name, run)` 建 span，回调里用 `update()` 补字段）：

| span 名 | 位置 | 上报内容 |
|---|---|---|
| `ai-chat` | `ai-chat.service.ts` | 非流式整轮：input = 问题，output = 答案 / 意图 / 评测快照，metadata = 意图、命中数、命中标题；外层 `withTraceAttrs` 带 userId / sessionId / tags |
| `retrieve-and-grade` | `agentic-retrieve.ts` | 检索-切题循环：input = 实际检索用的 query 与是否重试，output = 命中数 / 标题 / 评分 |
| `intent-classify` | `chat-query-rewrite.service.ts` | 意图分类：input = 问题，output = 路由计划 |
| `retrieve-grade` | 同上 | 切题评估：input = 问题 + 条数，output = 每条命中是否切题 |
| `rewrite-query` | 同上 | 追问改写：input = 原 query，output = 新 query |

流式链路（`ai-stream.service.ts`）走的是 LangChain 生态的 `CallbackHandler`（`@langfuse/langchain`），挂在 `agent.stream(..., { callbacks: [handler] })` 上，tags 为 `['agentic-rag', 意图]`，同样带 userId / sessionId；评测模式下额外加一个 `'eval'` tag 且不带 sessionId，方便在 Langfuse 里把「真人对话」和「跑分流量」分开过滤。

两个实现细节：

1. **内部 LLM 调用必须隔离**：意图分类 / 切题评估 / 追问改写用的是同一个模型，如果不隔离，它们输出的结构化 JSON 会被当成流式 token 混进回答里。`chat-query-rewrite.service.ts` 抽了个 `invokeIsolated()`，用 `AsyncLocalStorageProviderSingleton.runWithConfig({ callbacks: [], tags: ['kh-internal'], metadata: { khInternal: true } }, run, true)` 包住，既不污染回答流，也不在 trace 里多出根节点。
2. **与 LangSmith 并存不冲突**：LangSmith 走 LangChain 的 callback，Langfuse 走 OTel 的 span processor，两条通道各记各的，所以第八节的 `LANGSMITH_*` 可以继续留着。

### 5.9 RAG 评测（`pnpm eval:rag`）

调分块大小、RRF 常数、rerank 阈值这些参数，靠「试一下凭感觉」是不行的——改完一个参数，怎么知道是变好还是变坏？所以加了一套可重复的评测。

**三条设计原则**

1. **跑的就是线上那条链路**：`AiStreamService.runForEval()` 复用 `createTurnAgent()`，只是把 UI 事件丢给 `silentWriter()`、用 `agent.invoke` 拿最终答案，并且不落会话、不写记忆。避免「评测链路」和「线上链路」写成两套代码。
2. **用管理员身份跑**：`EVAL_USER_ID`（默认 `eval-admin`）对应 `ROLE_ADMIN`。否则文档 ACL 会把公开制度也过滤掉，测出来全是空召回。
3. **金标写进代码**：`src/ai/eval/golden-dataset.ts` 是 TS 常量数组，与 `agentic-rag.md` 的场景用例对齐；`relevantDocTitles` 用标题子串而不是 documentId，因为本地 / CI 的文档 ID 会变。

**9 条金标**（按 `metadata.id` / `metadata.suite`）

| suite | id | 考什么 |
|---|---|---|
| routing | `chitchat-hello` | 「你好」→ 闲聊，禁止检索 / 图谱 / 联网 |
| routing | `kb-not-profile` | 问的是人不是制度，但依然要走知识库 |
| kb-hit | `kb-travel-signoff` | 差旅加签规则，要点：张敏、加签 |
| kb-hit | `kb-vpn-account` | VPN 连不上 + 账号开通，要点：张伟 |
| kb-hit | `kb-release-window` | 发布窗口责任人，且答案里不能出现「王芳」（防串人） |
| rewrite | `kb-overtime-meal` | 空金标 + `expectRewrite`：只考「有没有真的改写 query」 |
| kb-empty | `kb-annual-party` | 库里没有这条制度 → 必须拒答 |
| kb-empty | `kb-intern-defense` | 同上（实习生转正答辩材料） |
| web | `web-fx` | 实时汇率 → 必须联网，禁止检索 / 图谱 |

**9 个评测器**（`src/ai/eval/evaluators.ts`；标 ✅ 的走 LLM judge，其余是纯规则判定）

| 指标 | 判定 | LLM 裁判 |
|---|---|---|
| `intent_match` | 意图与金标一致 → 1 | |
| `tool_policy` | 按意图校验 require / forbid 的检索、图谱、联网 | |
| `rewrite_loop` | 真的重试了、且新 query ≠ 原 query | |
| `refusal_quality` | 该拒答时拒了、且没有编造 → 1 | ✅ |
| `hit_at_5` | 前 5 条命中金标标题 | |
| `precision_at_5` | 前 5 条里相关的占比（一条没召回 = 0） | |
| `false_hit` | 空金标场景下不该有任何命中 | |
| `completeness` | 要点覆盖比例；出现 `mustNotContain` 的事实直接判 0 | ✅ |
| `groundedness` | 答案是否被检索片段支撑：supported 1 / mixed 0.5 / fabricated 0 | ✅ |

裁判模型由 `EVAL_JUDGE_MODEL` 指定，缺省依次回落 `MODEL_NAME` → `LLM_MODEL` → `qwen-plus`；`temperature: 0`，用 `withStructuredOutput(Zod schema)` 强制结构化输出。分数 `value === null` 表示「本场景不适用」（闲聊不判忠实度），这类分数**不写进 Langfuse**，避免把「跳过」当成 0 分拉低均值。

**怎么跑**

```bash
pnpm eval:rag                                  # 全量 9 条
EVAL_FILTER=kb-hit pnpm eval:rag               # 按 suite 过滤
EVAL_FILTER=kb-release-window pnpm eval:rag    # 只跑单条
EVAL_CONCURRENCY=4 pnpm eval:rag               # 并发（默认 2）
```

- 配了 `LANGFUSE_*`：以 `agentic-rag` 为名的 experiment 上报到 Langfuse，每条数据的 9 个分数挂在对应 trace 上，可横向对比不同 prompt / 模型 / 参数版本。
- 没配：终端逐条打印 `[id] intent=… answer=…` 以及每个指标的分数与注释。

注意：9 条只够冒烟与回归（防「改 A 坏 B」），不足以做统计意义上的效果对比；judge 与答题同源模型，存在自评偏置；目前也没接 CI。

---

## 六、API 一览

> 无全局路由前缀；除「公开」外都需带 `Authorization: Bearer <accessToken>`。
> 权限列的含义：`@Public` 免登录；`ROLE_*` 是角色要求；`domain:action` 是权限码要求。
>
> **状态码约定：业务成功一律 200**，包括 POST 创建类接口（不用 201）—— 每个 POST handler 都显式标了 `@HttpCode(HttpStatus.OK)`。失败仍返回语义化的 400 / 401 / 403 / 404 / 500，由 Nest 异常过滤器处理。
> 这么定是为了对齐 Apipost 自动化回归（每个接口的成功样例都断言「期望 200」），前端也只判响应体、不依赖状态码判成败。
> **这是刻意约定，不是 bug，不要"修正"回 201**（`@Post` 默认就是 201，删掉 `@HttpCode` 就会破坏约定）。

### 认证 `/auth`

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/auth/register` | 公开 | 注册（可能触发邮箱激活） |
| POST | `/auth/login` | 公开 | 登录，返回 access + refresh token |
| POST | `/auth/refresh` | 公开 | 用 refresh token 换新 token |
| GET | `/auth/verify-email` | 公开 | 邮箱激活（`?token=`） |
| POST | `/auth/password/reset/send-code` | 公开 | 发送 6 位重置码（60s 冷却） |
| POST | `/auth/password/reset` | 公开 | 用验证码重置密码 |
| POST | `/auth/logout` | 登录 | 登出 |
| GET | `/auth/me` | 登录 | 当前用户信息 + 权限列表 |
| GET | `/auth/reviewer-ids` | ADMIN / REVIEWER | 审核员列表 |

### 文档 `/documents`

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/documents` | `document:create` | 新建文档（纯元数据） |
| POST | `/documents/upload/parse` | `document:create` | 上传文件并解析（multipart，≤200MB，MinerU 全格式） |
| GET | `/documents` | `document:list` | 分页列表（可见性过滤） |
| GET | `/documents/:id` | `document:list` | 详情（可见性过滤） |
| PATCH | `/documents/:id` | `document:edit` | 改元数据（校验 canWrite） |
| DELETE | `/documents/:id` | `document:delete` | 软删除 + 清索引 |
| PUT | `/documents/:id/publish` | `document:edit` | 发布（可按开关转待审） |
| PUT | `/documents/:id/archive` | `document:edit` | 归档（清三套索引） |
| PUT | `/documents/:id/save-draft` | `document:edit` | 下架为草稿（清索引） |
| POST | `/documents/:id/reviews/submit` | `document:edit` | 提交审核 |
| GET | `/documents/:id/reviews/current` | `document:list` | 当前审核状态 |
| GET | `/documents/:id/reviews/history` | `document:list` | 审核历史 |
| GET | `/documents/reviews/tasks` | REVIEWER / ADMIN + `document:review` | 我的审核待办（分页） |
| GET | `/documents/reviews/tasks/pending-count` | REVIEWER / ADMIN + `document:review` | 待办数量角标 |
| POST | `/documents/reviews/tasks/:taskId/approve` | REVIEWER / ADMIN + `document:review` | 审核通过 → 发布 + 建索引 |
| POST | `/documents/reviews/tasks/:taskId/reject` | REVIEWER / ADMIN + `document:review` | 驳回 → 回到草稿 |
| POST | `/documents/:id/likes` | `document:list` | 点赞 / 取消点赞，返回最新计数 |
| POST | `/documents/:id/favorites` | `document:list` | 收藏 / 取消收藏 |
| GET / POST | `/documents/:id/comments` | `document:list` | 评论列表（两级）/ 发表评论 |
| DELETE | `/documents/:id/comments/:commentId` | `document:list` | 删评论（本人或管理员） |
| GET / POST | `/documents/:id/shares` | `document:list` | 分享链接列表 / 创建（可选密码、有效期） |
| DELETE | `/documents/:id/shares/:shareId` | `document:list` | 关闭分享链接 |
| GET | `/documents/:id/versions` | `document:list` + `document:version` | 版本列表 |
| POST | `/documents/:id/versions/:versionId/restore` | `document:edit` + `document:version` | 回滚到该版本（生成新版本） |

> `GET /documents` 支持 `mine=1`，只返回当前用户自己的文档（含草稿）；列表与详情都会带上 `categoryName`。

### 分类 / 收藏 / 公开分享 / 通知

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/categories/tree` | `document:list` 或 `document:category:query` | 分类树（列表筛选与下拉用） |
| POST / PUT / DELETE | `/categories`、`/categories/:id` | `document:category` | 分类维护（逻辑删除） |
| GET | `/favorites` | `document:list` | 我的收藏（分页） |
| GET | `/shares/:code` | 公开 | 分享预览：是否有效、是否需要密码 |
| POST | `/shares/:code/access` | 公开 | 校验密码并返回正文 |
| GET | `/notifications` | 登录 | 我的通知（分页） |
| GET | `/notifications/unread-count` | 登录 | 未读数（铃铛轮询） |
| POST | `/notifications/:id/read`、`/notifications/read-all` | 登录 | 标记单条 / 全部已读 |
| POST | `/notifications/broadcast` | ADMIN | 发系统通知（指定用户，留空则全员） |

### 用户 / 角色 / 权限 / 团队

| 方法 | 路径 | 权限 |
|---|---|---|
| PUT | `/users/me` | 登录 |
| PUT | `/users/password/change` | 登录 |
| GET | `/users/me/stats` | 登录（我创建的文档统计） |
| GET / PUT | `/users/:id/roles` | ADMIN + `system:user` |
| GET / PUT | `/users/:id/permissions` | ADMIN + `system:user` |
| GET / POST / PUT / DELETE | `/users/page`、`/users`、`/users/:id` 等 | ADMIN |
| PUT | `/users/:id/password/reset` | ADMIN |
| GET / POST / PUT / DELETE | `/roles`、`/roles/:id`、`/roles/list` | ADMIN |
| GET / PUT | `/roles/:id/permissions` | ADMIN + `system:role` |
| GET | `/permissions/list`、`/permissions/tree`、`/permissions/page` | ADMIN + `system:permission` |
| POST / PUT / DELETE | `/permissions`、`/permissions/:id` | ADMIN + `system:permission:create|edit|delete` |
| GET / POST / PUT / DELETE | `/teams`、`/teams/:id`、`/teams/:id/members` | ADMIN + `system:team` |
| GET | `/teams/mine` | 登录（我所属/负责的团队） |

### 检索 / 图谱 / 问答

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/search` | `search` | 文档级全文检索（IK 高亮 + 分页） |
| POST | `/rag/search` | `search` | 混合检索，只返回召回结果，不调 LLM |
| POST | `/ai/chat` | `search` | 非流式问答 |
| POST | `/ai/chat/stream` | `search` | SSE 流式问答 |
| GET / POST | `/ai/sessions` | `search` | 会话列表 / 新建会话 |
| GET | `/ai/sessions/:id/messages` | `search` | 会话消息（含 sources） |
| PATCH / DELETE | `/ai/sessions/:id` | `search` | 改标题 / 删除会话 |
| GET | `/graph/overview` | `search` | 图谱全景统计 |
| GET | `/graph/search` | `search` | 按关键词查实体 |
| GET | `/graph/nodes`、`/graph/edges` | `search` | 节点 / 边列表 |

---

## 七、数据模型

### PostgreSQL（19 张表，见 `init-scripts/postgresql/init.sql`）

| 表 | 用途 | 关键字段 |
|---|---|---|
| `kh_document` | 文档元数据 | id、title、summary、category_id、tags、status、is_public、team_id、author_id、content_id、view/like/comment_count、deleted |
| `kh_document_review` | 审核流水 | id、document_id、submitter_id、reviewer_id、status、comment |
| `kh_user` | 用户 | id、username、password、email、nickname、avatar、status |
| `kh_role` | 角色 | id、role_code、role_name、remark、status |
| `kh_permission` | 权限（树） | id、parent_id、permission_code、permission_name、type（菜单/按钮/接口）、path |
| `kh_user_role` | 用户-角色 | user_id、role_id |
| `kh_role_permission` | 角色-权限 | role_id、permission_id |
| `kh_user_permission` | 用户直授权限 | user_id、permission_id、granted_by |
| `kh_team` | 团队（树） | id、team_name、parent_id、leader_id、description |
| `kh_team_member` | 团队成员 | team_id、user_id |
| `kh_ai_session` | AI 会话 | id、user_id、title、created_at |
| `kh_ai_message` | AI 消息 | id、session_id、role、content、sources（JSONB） |
| `kh_category` | 文档分类（树） | id、name、parent_id、sort、description、deleted |
| `kh_comment` | 评论（两级） | id、document_id、user_id、user_name、content、parent_id、deleted |
| `kh_document_like` | 点赞 | id、document_id、user_id（唯一约束） |
| `kh_document_favorite` | 收藏 | id、document_id、user_id（唯一约束） |
| `kh_document_share` | 分享链接 | id、document_id、token、created_by、expire_at、revoked、require_password、password_hash |
| `kh_document_version` | 正文版本快照 | id、document_id、version、title、content、summary、created_by |
| `kh_notification` | 站内通知 | id、user_id、type（like/comment/system）、title、content、document_id、sender_id、is_read |

种子数据包含：三个角色、三个账号（admin / reviewer / user，密码 `123456`）、完整权限树（含 `document:category`、`document:category:query`、`document:version`）、示例团队与成员、三个初始分类。

### MongoDB

集合 `document_content`：`document_id`（唯一索引）、`content`（Markdown 正文）、时间戳。按 `document_id` 单点读写，是「文档正文」的唯一来源。

### Elasticsearch（2 个索引，mapping 由代码启动时创建）

| 索引 | 粒度 | 主要字段 |
|---|---|---|
| `kh_chunk` | 分块级 | chunk_id、document_id、document_title、content、heading、chunk_index、total_chunks、author_id、team_id、is_public、doc_status、publish_time、indexed_at、**embedding**（1024 维 dense_vector，cosine） |
| `kh_document` | 文档级 | id、title、summary、content、category_id、tags、status、is_public、team_id、author_id、各种计数、publish_time |

中文分析器：`ik_max_word`（索引）+ `ik_smart`（检索）。

### Neo4j

| 元素 | 说明 |
|---|---|
| 节点 `KnowledgeDocument` | 文档节点，带 is_public / team_id / author_id 等可见性属性 |
| 节点 `DocumentChunk` | 文本块节点，归属文档 |
| 节点 `KnowledgeEntity` | 抽取出的实体（人名、组织、概念、资源等，完整枚举见 `kg-extraction.schema.ts`） |
| 关系 `HAS_CHUNK` | 文档 → 块 |
| 关系 `MENTIONS` | 块 → 实体 |
| 关系 `RELATED_TO` | 实体 ↔ 实体（带关系描述） |

### Redis Key 约定

| Key 前缀 | 内容 | TTL |
|---|---|---|
| `email:activation:token:*` | 激活 token → userId | 24h |
| `email:activation:user:*` | userId → token（重发时作废旧 token） | 24h |
| `password:reset:code:*` | 6 位重置验证码 + 60s 重发冷却 | 10min |
| `kh:chat:*` | 对话短期记忆热窗口（最近 20 条） | `CHAT_SHORT_MEMORY_TTL_SECONDS=86400` |

---

## 八、配置项

`.env.example` 按用途分组，完整清单以该文件为准，常用项：

| 分组 | 变量 | 说明 |
|---|---|---|
| 应用 | `PORT`、`APP_PUBLIC_URL` | 服务端口 / 邮件链接的对外地址 |
| Postgres | `POSTGRES_HOST/PORT/USER/PASSWORD/DB` | `synchronize: false`，表结构全靠 init.sql |
| Mongo | `MONGO_URI` | 正文存储 |
| Redis | `REDIS_HOST/PORT/PASSWORD/DB` | 缓存与记忆 |
| ES | `ELASTICSEARCH_NODE`、`ELASTICSEARCH_ENABLED` | 关闭即降级为「无全文/向量检索」 |
| Neo4j | `NEO4J_URI/USER/PASSWORD`、`NEO4J_ENABLED` | 关闭即跳过图谱 |
| MQ | `RABBITMQ_URL`、`RABBITMQ_ENABLED` | 关闭则不建索引（需手工触发） |
| 对象存储 | `RUSTFS_ENABLED`、`RUSTFS_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET` | 解析出的图片（`document-images`）与原文件；解析含图时**必须启用** |
| 文件解析 · MinerU | `MINERU_API_TOKEN`（必填）、`MINERU_API_BASE=https://mineru.net`、`MINERU_MODEL_VERSION=vlm`、`MINERU_LANGUAGE=ch`、`MINERU_ENABLE_FORMULA/ENABLE_TABLE=true`、`MINERU_POLL_INTERVAL_MS=3000`、`MINERU_POLL_TIMEOUT_MS=600000` | PDF / 图片 / Office → Markdown 的精准解析 |
| JWT | `JWT_SECRET`、`JWT_ACCESS_EXPIRES=2h`、`JWT_REFRESH_EXPIRES=7d` | 双 token（access 与 refresh 同一密钥签发） |
| 邮箱 | `REQUIRE_EMAIL_VERIFICATION`、`MAIL_*`、`APP_PUBLIC_URL` | 是否强制激活 + SMTP + 邮件链接地址 |
| 审核 | `DOCUMENT_REQUIRE_APPROVAL` | 是否走审核流程（默认 true） |
| LLM | `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`MODEL_NAME`、`KG_LLM_TIMEOUT_MS` | 问答与实体抽取 |
| Embedding | `EMBEDDING_DIMENSION=1024`、`EMBEDDING_BASE_URL`、`EMBEDDING_MODEL`、`EMBEDDING_API_KEY`（可选） | 不配 Key 则本地哈希降级 |
| Rerank | `RAG_RERANK_ENABLED`、`RAG_RERANK_MODEL`、`RERANK_API_KEY`（可选）、`RAG_MIN_SCORE=0.4` | 精排与过滤阈值 |
| 混合检索 | `RAG_HYBRID_TOP_K=20`、`RAG_RRF_C=60`、`RAG_CHUNK_SIZE=512`、`RAG_CHUNK_OVERLAP=64` | 召回与分块参数 |
| 记忆 | `CHAT_SHORT_MEMORY_MAX_MESSAGES=20`、`CHAT_SHORT_MEMORY_TTL_SECONDS=86400`、`MEM0_API_KEY`（可选）、`MEM0_TOP_K=5` | 三层记忆 |
| 联网 | `BOCHA_API_KEY`（可选） | 不配则 `web_search` 返回提示 |
| 观测 · LangSmith | `LANGSMITH_TRACING`、`LANGSMITH_API_KEY`、`LANGSMITH_PROJECT` | LangChain callback 跟踪（可选） |
| 观测 · Langfuse | `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`（两个都配才启用）、`LANGFUSE_BASE_URL` | 对话 tracing + 评测上报；不配则整套空转 |
| 评测 | `EVAL_JUDGE_MODEL`、`EVAL_CONCURRENCY=2`、`EVAL_FILTER`、`EVAL_USER_ID` | `pnpm eval:rag` 用；`EVAL_FILTER` 匹配金标 id 或 suite |
| ID | `SNOWFLAKE_WORKER_ID`、`SNOWFLAKE_OFFSET` | 雪花 ID 节点号与起始时间戳 |

---

## 九、手工验证

项目没有单元测试，验证靠同目录下的 curl 脚本（按顺序执行即可跑通完整链路）：

| 文件 | 覆盖内容 |
|---|---|
| `curl.md` | 基础文档 CRUD、上传解析、发布流程 |
| `curl3.md` | 补充场景 |
| `curl-document-status.md` | 状态流转与审核流程 |
| `curl-auth.md` | 注册、登录、刷新、邮箱激活、重置密码 |
| `curl-rbac.md` | 角色与权限分配 |
| `curl-users.md` | 用户 CRUD 与个人资料 |
| `curl-read.md` | 可见性与权限读取 |
| `curl-rag.md` | 混合检索与问答接口 |
| `agentic-rag.md` | Agentic RAG 场景化用例（含预期行为） |
| `chat-memory.md` | 会话记忆与短期窗口行为 |

`test-files/` 提供测试语料（多份文本版 PDF、扫描版 PDF（`scanned-1page.pdf`）、DOCX、XLSX、PPTX）与 `rag-*.json` 评测集；扫描件与图片适合验证 MinerU 的 OCR 与版式还原。

### 评测跑分（不用起 HTTP 服务）

```bash
pnpm eval:rag                        # 全量 9 条金标，走真实检索链路
EVAL_FILTER=kb-hit pnpm eval:rag     # 按 suite 过滤；也可直接传单条 id
```

判分逻辑见 5.9。没配 Langfuse 时分数直接打在终端；配了则上报为 `agentic-rag` experiment。

---

## 十、已知限制与后续

**设计上的固有限制**

1. **无跨库事务**：Postgres 与 Mongo 各自独立，写正文靠「失败补偿删除」保证最终一致，极端情况（补偿本身失败）仍需人工介入。
2. **索引是最终一致**：发布后要等 MQ 消费者处理完，ES / Neo4j 才有数据。刚发布立刻搜索可能搜不到，属预期行为。
3. **MQ 无重试与死信队列**：消费失败只记日志，需要重跑时得手工重新投递消息。
4. **图谱抽取依赖 LLM**：未配 `OPENAI_API_KEY` 时 KG 管线会失败（其它功能不受影响）。
5. **评测要花真实模型额度**：全量 9 条金标会跑 9 次完整 Agent 链路，其中 `refusal_quality`、`completeness`、`groundedness` 还要额外调 LLM judge；judge 与答题同源模型，存在自评偏置。
6. **解析强依赖外部服务**：文件解析要连 MinerU 公网接口并占用其额度，没有 token 或断网时上传直接失败；解析是同步等待（轮询最长 10 分钟），大文件会让请求长时间挂起，后续可考虑改成 MQ 异步解析。

**可以改进的点**

- 表结构全量依赖 `init.sql`，且只在首次建卷时执行，缺迁移工具（可引入 TypeORM migration）。
- 没有单元测试：`document-status.ts`、`document-access.ts` 都是纯函数，是最值得先补的两处。
- 没有 API 文档（Swagger）：目前靠 `curl-*.md` 手工验证。
- `docker-compose.yml` 里 Postgres 的 healthcheck 写的是 `pg_isready -U user -d hello_pg`，与实际库名 `knowledge_hub` 不一致（`pg_isready` 只探测服务是否响应，故不会阻断启动，属遗留笔误）。
- 检索参数（分块大小、RRF 常数、rerank 阈值）仍是经验值：5.9 的 `eval:rag` 已经能给出可对比的分数，但还没做「按分数自动搜参」，也没接 CI。


