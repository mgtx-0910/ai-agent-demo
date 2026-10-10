# LangChain AI Agent 第三阶段学习总结：从「能力清单」到「可交付系统」

## 概述

第一阶段的成果是 LangChain 组件与 LCEL 流水线；第二阶段的成果是一排各自能跑通的子项目：NestJS 工程化、LangGraph 图编排、ES 混合检索、Neo4j 图谱、Redis / Mem0 记忆、语音、定时任务。

但把它们摆在一起会发现一个尴尬的事实——**每块能力都能单独演示，却凑不成一个别人能用的东西**：

- 有检索，却没人管「哪些内容能被谁检索到」；
- 有权限装饰器，但它只挡在接口层，挡不住**数据与索引**层；
- 有流式问答，但没有一个界面把它交到使用者手上；
- 有五个存储，但从没有在一套业务规则下协同过。

第三阶段的目的**不是再学一个新框架**，而是把前面所有能力组装成一个可交付的业务系统——企业知识库。本阶段共沉淀 **2 个子项目**：

| 序号 | 子项目 | 首次提交 | 主题 |
|------|--------|----------|------|
| ① | `knowledge-hub-backend` | 2026-09-16 | 文档 → 审核 → 三套索引 → 混合检索 → Agentic RAG + RBAC |
| ② | `knowledge-hub-frontend` | 2026-10-10 | React 管理台：把后端能力变成可操作的界面 |

> 日期取自仓库中**各子项目目录首次提交**的时间。后端从 2026-09-16 起迭代到 2026-10-10（8 次提交，含上传解析、账号权限体系、AI 问答三个阶段）；前端于 2026-10-10 纳入仓库。第二阶段最后一个项目 `mem0-test` 停在 09-08。

```
📦 综合实战（09-16 → 10-10）
┌──────────────────────────────────────────────────────────────────┐
│  knowledge-hub-backend        09-16 起（8 次提交）                 │
│    文档管理 · 审核状态机 · 异步三路索引 · 混合检索                  │
│    Agentic RAG · 三层记忆 · RBAC + 可见性下推 · 文件解析            │
├──────────────────────────────────────────────────────────────────┤
│  knowledge-hub-frontend       10-10                                │
│    登录会话 · 文档生命周期 · 全文检索 · 流式问答 · 图谱 · 系统管理    │
└──────────────────────────────────────────────────────────────────┘
```

下面按「后端 → 前端」两部分展开。

---

## 第一部分：knowledge-hub-backend——把业务链路做成服务

### 一、第一个决策不是写代码，而是分存储

项目里有五种存储，它们不是"技术栈堆砌"，而是按数据形态分工的结果：

| 组件 | 存什么 | 为什么是它 |
|---|---|---|
| **PostgreSQL** | 文档元数据、审核流水、用户/角色/权限、团队、AI 会话 | 需要事务、外键、条件分页查询 |
| **MongoDB** | 文档 Markdown 正文（`document_content`） | 长文本、无需 join、按 `document_id` 单点读写 |
| **Elasticsearch** | `kh_chunk`（分块 + 向量）、`kh_document`（文档级全文） | 中文分词（IK）+ kNN 向量检索 |
| **Neo4j** | 文档 / 块 / 实体节点与关系 | 「实体 A 与实体 B 什么关系」这类多跳问题 |
| **Redis** | 验证码、激活 token、对话短期热窗口 | 短 TTL 的一次性数据与高频读写 |
| **RustFS (S3)** | PDF 抽取的图片、原文件 | 二进制对象不适合进数据库 |
| **RabbitMQ** | 发布后的三条索引流水线消息 | 建索引耗时长（embedding + LLM 抽取），必须异步 |

其中最有学习价值的一条是：**Postgres 与 Mongo 是两个独立库，没有跨库事务**。于是写正文的落库顺序被设计成「先写 Mongo → 再写 Postgres → 失败则补偿删除 Mongo」（`src/document/document.service.ts`）。这类"最终一致"的取舍，是第一、二阶段在单库里写 CRUD 时不会遇到的。

### 二、文档生命周期：状态机 + 可开关的审核

文档有四个状态，流转规则被抽成**纯函数**集中在 `src/document/document-status.ts`：

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

三条关键约束：

| 规则 | 函数 | 为什么 |
|---|---|---|
| 只有草稿 / 已发布 / 已归档可提交审核 | `canSubmitReview` | 已发布再提审会先清索引，避免旧索引与待审内容并存 |
| 待审核期间禁止改正文 | `canEditContent` | 防止「审的内容」与「发布的内容」不一致 |
| 只有已发布可归档 | `canArchive` | — |

审核本身是**可开关**的：`DOCUMENT_REQUIRE_APPROVAL=true`（默认）时发布进「待审核」，`false` 时直接发布。这个开关让同一套代码既能用于强合规场景，也能用于内部轻量场景——业务策略进配置，而不是进 if-else。

### 三、发布之后：三路异步索引管线

发布是一个轻量动作（写库 + 投递消息），真正的索引构建由 MQ 消费者完成：

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

管线由 `PipelineOrchestrator` 统一编排（加载文档 → 写索引），四个设计要点：

1. **消息只携带 `documentId`**，不塞正文——正文在 Mongo，消费者自己回查，避免 MQ 里塞大文本；
2. **单篇失败不影响其它文档**：逐篇 `try/catch` 并记日志；
3. **重建前先清旧块**（`deleteByDocId`），重复发布不产生脏数据；
4. **可见性变更走专用分支**（`updateVisibility`）：公开 / 团队变化只更新三套索引上的 `is_public` / `team_id`，**不重跑 embedding 与实体抽取**。

再加上 `ELASTICSEARCH_ENABLED` / `NEO4J_ENABLED` 的降级开关，任何一路索引挂了都不阻塞主流程。这是第二阶段 `es-test`、`neo4j-graphrag` 里学到的能力第一次被"生产化"地编排。

### 四、混合检索：双路召回 → RRF → rerank

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

与第二阶段练习版的差别在于**每一环都有降级路径**：

| 故障 | 行为 |
|---|---|
| Embedding Key 未配置 | 使用本地哈希向量 |
| 向量化失败 | 跳过向量路，退化为纯关键词检索 |
| Rerank 不可用或失败 | 直接返回 RRF 融合顺序 |

还有一个容易被忽略的工程细节：ES 里 `document_id` 用 `keyword` 而非 `long`，因为雪花 ID 超出 JS 的 `Number.MAX_SAFE_INTEGER`，用 long 会丢精度。

### 五、Agentic RAG：会自我评估的问答

`/ai/chat` 与 `/ai/chat/stream` 推理流程一致，核心在 `src/ai/ai-stream.service.ts`：

```
用户提问
  ▼
意图分类（chat-query-rewrite）→ 决定本轮开哪些工具、是否消解追问指代
  ▼
createAgent({ model, tools, systemPrompt, middleware })
  ├── retrieve_knowledge   检索知识库（仅当前用户可见文档）+ 切题评估
  ├── rewrite_query        评估不切题时改写检索词（最多再查一次）
  ├── retrieve_graph       检索图谱实体与关系（与检索工具首次并行调用）
  └── web_search           知识库不足时联网（Bocha）
  ├── summarizationMiddleware    消息超 12 条自动总结，压缩上下文
  └── modelCallLimitMiddleware   runLimit 8，达上限优雅结束
  ▼
流式输出：思考过程 + 正文 + 引用来源（sources）
```

从第二阶段 `advanced-rag` 的"路由 / 多跳 / 联网回退"到这里，多了一件以前没有的东西：**刻意的行为约束**。它们不写在提示词的"请注意"里，而是写进工具描述与循环次数：

- 知识库检索**本轮最多两次**，避免无限重试；
- 图谱结果只用于说明实体关系，**不能当制度原文**；
- 联网只在知识库循环结束后仍不足时触发，**不允许用网页替代已切题的内部资料**；
- 检索一律带上当前用户的可见性范围。

### 六、记忆：记忆不是知识库

会话记忆分三层，每层职责写在名字里：

| 层 | 存储 | 作用 | 失效行为 |
|---|---|---|---|
| 会话历史 | Postgres `kh_ai_session` / `kh_ai_message` | 权威存储，`sources` 用 JSONB 存引用 | 永久 |
| 短期热窗口 | Redis | 最近 20 条（`CHAT_SHORT_MEMORY_MAX_MESSAGES`） | TTL 后不丢历史，下次从 Postgres 回填 |
| 长期记忆 | Mem0（可选） | 跨会话的用户偏好类信息 | 未配 Key 则整体跳过 |

这一节真正要记住的是那条边界：**用户偏好可以记住，制度条文必须以检索结果为准**——不能让"记忆"覆盖"知识库"。记忆层解决的是"懂你"，检索层解决的是"答对"。

### 七、权限：RBAC 只是入口，可见性下推才是关键

**认证**：JWT 双 token（access 2h / refresh 7d），密码 bcrypt 哈希存储；注册可开启邮箱激活（`REQUIRE_EMAIL_VERIFICATION`），激活 token 与重置验证码都放 Redis 且带 TTL。

**授权**：三个全局守卫按顺序执行：

```
请求 ──► JwtAuthGuard ──► RolesGuard ──► PermissionsGuard ──► Controller
        （是否登录）      （@Roles）      （@RequirePermission）
             └── 标了 @Public() 的接口跳过登录校验
```

权限是「角色权限 ∪ 直授权限」：用户最终权限 = `kh_user_permission` ∪（`kh_user_role` → `kh_role_permission`），ADMIN 额外并入 `ADMIN_OPERATION_PERMISSIONS`。角色只有三个（`ROLE_ADMIN` / `ROLE_REVIEWER` / `ROLE_USER`），权限码分三级（菜单 / 按钮 / 接口），如 `document:list`、`document:create`、`system:permission:edit`。

真正有含金量的是**数据可见性**：规则只写一次（`src/document/document-access.ts`），再下推到三个存储各自的查询语句。

```
可读 = 管理员/审核员（unrestricted）
     ∪ 文档作者是自己
     ∪ （已发布 ∧（文档公开 ∨ 文档 team_id ∈ 我的团队集合））

可写 = 管理员 ∪ 文档作者
```

| 存储 | 下推方式 |
|---|---|
| Postgres | QueryBuilder 拼接可见性条件（列表 / 详情） |
| Elasticsearch | `esVisibilityFilter()` 生成 `bool.should + minimum_should_match:1`，再由 `wrapEsQuery()` 把**相关性放 must、权限放 filter**，保证权限条件不影响打分 |
| Neo4j | `neo4jDocumentAccessWhere()` 生成 Cypher 条件 + `neo4jAccessParams()` 传参，图谱查询同样只返回可见文档抽出的节点 |

`teamIds` 在登录时随 `AuthUser` 放进请求上下文，避免每次查询都回表。这里体现的是第二阶段学不来的东西：**权限不是一个装饰器，而是一条从 HTTP 入口贯穿到索引存储的约束**。

### 八、文件解析：五种格式 → Markdown

上传接口用 `FileInterceptor` 接收（限 50MB），`src/document/parser/` 按扩展名分发：

| 类型 | 处理方式 |
|---|---|
| PDF | 文本抽取；图片单独抽出上传 RustFS，正文里替换为图片引用 |
| DOCX | `mammoth` 转 HTML → `turndown` 转 Markdown |
| XLSX | `exceljs` 逐 Sheet 转 Markdown 表格 |
| PPTX | 解析每页文本 |

解析结果统一是 Markdown（写 Mongo），元数据（标题、分类、团队、是否公开）写 Postgres。**先把异构文件归一，后面的检索链路才不需要区分来源格式**。

---

## 第二部分：knowledge-hub-frontend——把能力变成界面

前端的定位很克制：**只负责体验层，真正的权限与可见性拦截仍在后端**，前端隐藏菜单 / 路由只是减少误操作。

### 九、工程与对接：一个 `/api` 代理解决跨域

```
浏览器 ──► Vite dev server :5173 ──/api/*──► http://127.0.0.1:3000/*
                                   （rewrite 去掉 /api 前缀）
```

- 代理配置在 `vite.config.ts`：`/api` → `127.0.0.1:3000`，`changeOrigin: true`，并把**超时设为 0**——问答是长连接流，必须关掉代理超时；
- 后端没有全局路由前缀，所以 `rewrite` 把 `/api` 摘掉；`.env` 里只放 `VITE_API_BASE=/api` 一项；
- `.env` 被仓库根 `.gitignore` 忽略，`client.ts` 用 `import.meta.env.VITE_API_BASE || '/api'` 兜底；
- 生产部署没有内置反代，需要把 `/api` 指向后端或改 `VITE_API_BASE`。技术栈为 React 19 + TypeScript + Vite 8 + Ant Design 6（`zh_CN`）+ React Router 7 + AI SDK v7 + ECharts 6。

### 十、路由与权限：两个包装组件

`src/App.tsx` 用 `Guard`（是否登录）与 `Perm`（是否具备权限码）控制访问：

| 路由 | 进入条件 | 说明 |
|---|---|---|
| `/login` | 公开 | 登录；已登录则跳首页 |
| `/dashboard` | 登录 | 工作概览 |
| `/documents`、`/documents/:id` | `document:list` | 列表与详情（可见性由后端过滤） |
| `/documents/new`、`/documents/:id/edit` | `document:create` / `document:edit` | 新建上传解析、编辑元数据 |
| `/search`、`/chat`、`/graph` | `search` | 全文检索 / 流式问答 / 图谱 |
| `/profile` | `profile` | 资料、改密 |
| `/admin/users`、`/admin/roles`、`/admin/teams` | `ROLE_ADMIN` | 用户、角色权限树、团队树 |
| `/admin/reviews` | `ROLE_ADMIN` 或 `ROLE_REVIEWER` | 审核工作台（通过 / 驳回） |

权限判断集中在 `utils.ts` 的 `can()`：`ROLE_ADMIN` 直接放行，其余查 `user.permissions`；菜单项用同一套规则动态生成。一个容易被忽略的细节是：**登录后每次进入布局都会重新拉一次 `/auth/me`**，避免权限变更后菜单过期。文档可见性标签（公开 / 团队可见 / 仅自己）只作展示，真实过滤在后端。

### 十一、流式问答：接上层协议，而不是自己造

`ChatPage.tsx` 没有用后端封装的 `/ai/chat`，而是直接用 AI SDK 的流式客户端：

```
useChat({ id: 'kh-chat', transport: new DefaultChatTransport({ api: '/api/ai/chat/stream', headers }) })
   │  headers() 每轮动态取 accessToken
   ▼
POST /ai/chat/stream（AI SDK UI Message Stream 协议）
   │
   ├─ onData: data-session  → 把 sessionId 写进地址栏 ?session=xxx
   ├─ onFinish: 重新拉会话列表（标题可能已被生成）
   └─ onError: 提示错误
```

- `id` 固定为 `kh-chat`，所以在页面间切换时同一条流不会中断；流式期间禁用「新对话 / 切换 / 删除」，并提供「停止」按钮；
- 历史回放：`GET /ai/sessions/:id/messages` → `historyToUIMessages()` 还原成 UIMessage（含 `sources`）。

消息渲染是前端最大的一块逻辑（`components/ChatMessageParts.tsx`），按 part 类型分派：

| part | 展示 |
|---|---|
| `reasoning` / `data-think` | 思考过程（连续片段合并） |
| `text` | Markdown 正文；`stripInternalToolJson()` 过滤评估 / 改写模型吐出的内部 JSON |
| `data-sources` | 引用资料；`citedSources()` 只保留正文里真正标了 `[n]` 的 |
| `data-intent` | 意图分类结果（本轮开哪些工具） |
| `data-retrieve` / `data-graph` / `data-eval` | 检索命中片段 / 图谱子图 / 切题评估 |
| `data-status`、`source-document`、`source-url` | 阶段状态、文档来源、联网来源 |

也就是说，**回答正文之外，「意图 → 检索 → 图谱 → 评估」整条推理轨迹都是可见的**——这正是后端刻意流式输出思考过程与评估结果的意义：让用户能判断答案的依据，而不是只能选择信或不信。

### 十二、图谱可视化：一份数据，两处复用

`components/ForceGraph.tsx` 用 ECharts 力导向布局实现，图谱页与问答内的检索轨迹图共用同一个组件：

| 元素 | 取值 |
|---|---|
| 节点 kind | `document` / `entity` / `tag` |
| 边 kind | `mentions`（文档—实体）/ `related`（实体—实体）/ `tagged` |

前端还有一个值得记住的安全细节：ES 高亮结果经 `safeHighlight` 转义后再放行 `<em>`，避免高亮注入变成 XSS。

---

## 十三、总结

### 13.1 第三阶段究竟交付了什么？

| 维度 | 第一 / 第二阶段 | 第三阶段 |
|---|---|---|
| 形态 | 独立脚本、独立服务、独立演示 | 一个业务系统的前后端 |
| 数据 | 单库或单一检索库 | 七种存储按数据形态分工，跨库最终一致 |
| 检索 | 能召回 | 召回 → 融合 → 精排 → 引用，且每环可降级 |
| 问答 | 一次调用 | Agentic RAG：意图 → 检索 → 评估 → 改写 → 联网 |
| 权限 | 接口级装饰器 | RBAC + 可见性规则下推到 PG / ES / Neo4j |
| 交付 | "能跑给你看" | 能登录、能上传、能审核、能检索、能问、能管 |

一条贯穿全项目的主线是：**前面学的是"让每块能力跑起来"，这一阶段学的是"让它们互相约束着一起跑"**——索引要跟着状态走，权限要跟着数据走，记忆不能越权替知识库说话。

### 13.2 四条认识链的终点

把三个阶段连起来，四条主线的演进是完整的：

```
工程形态：.mjs 脚本 → NestJS 服务（SSE/DI/Swagger）→ 多存储协同的业务系统 + React 管理台
编排方式：手写 ReAct → LCEL → LangGraph 图 → createAgent → 中间件 → Agentic RAG（工具 + 评估 + 有限重试）
检索能力：向量召回 → 混合检索 + Rerank → GraphRAG → 双路并行 + RRF + 阈值 + 引用出处 + 可见性过滤
记忆体系：截断/总结/检索 → Redis 短期 + Mem0 长期 + LangGraph checkpointer → 三层记忆并明确"记忆 ≠ 知识库"
权限边界：无 → 单接口鉴权 → 三角色 + 三级权限码 + 三存储可见性下推
```

### 13.3 已知限制（写在文档里，比藏在代码里好）

后端：无跨库事务（靠补偿删除保证最终一致）；索引是最终一致（刚发布立刻搜不到属预期）；MQ 无重试与死信队列；图谱抽取依赖 LLM；表结构全量依赖 `init.sql`、缺迁移工具；`document-status.ts` / `document-access.ts` 是纯函数却仍未补单测。

前端：token 存 localStorage 有 XSS 风险（更稳的是 httpOnly Cookie + CSRF）；无自动化测试，只有 oxlint 与手工验证；问答流未做断线重连；审核无实时通知。

### 13.4 一句话收尾

第一阶段学会的是"**用 LangChain 把大模型变成工业流水线**"；第二阶段学会的是"**把流水线装进真实系统**"；第三阶段学会的是"**把系统变成一个别人真能用的东西**"——文档进得去、知识找得到、答案有出处、权限管得住。到这里，仓库不再是一堆示例的集合，而是一个能交付、也能说清哪里还没做好的项目。
