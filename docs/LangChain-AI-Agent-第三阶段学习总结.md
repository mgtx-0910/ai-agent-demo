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
| ① | `knowledge-hub-backend` | 2026-09-16 | 文档 → 审核 → 互动 → 三套索引 → 混合检索 → Agentic RAG + RBAC |
| ② | `knowledge-hub-frontend` | 2026-10-10 | React 管理台：把后端能力变成可操作的界面 |

> 日期取自仓库中**各子项目目录首次提交**的时间。后端从 2026-09-16 起迭代到 2026-10-10（8 次提交，含上传解析、账号权限体系、AI 问答三个阶段）；前端于 2026-10-10 纳入仓库。第二阶段最后一个项目 `mem0-test` 停在 09-08。

```
📦 综合实战（09-16 → 10-10）
┌──────────────────────────────────────────────────────────────────┐
│  knowledge-hub-backend        09-16 起（8 次提交）                 │
│    文档管理 · 审核状态机 · 异步三路索引 · 混合检索                  │
│    Agentic RAG · 三层记忆 · RBAC + 可见性下推 · 文件解析            │
│    Langfuse tracing · 9 条金标 RAG 评测                            │
│    文档互动 · 分类与版本 · 站内通知                                │
├──────────────────────────────────────────────────────────────────┤
│  knowledge-hub-frontend       10-10                                │
│    登录会话 · 文档生命周期 · 互动与通知 · 检索 · 问答 · 图谱 · 管理   │
└──────────────────────────────────────────────────────────────────┘
```

下面按「后端 → 前端」两部分展开。

> 📌 **相关章节**：**Langfuse 可观测性**与 **9 条金标的 RAG 评测**见第九节；`knowledge-hub-backend/README.md` 的 5.8 / 5.9 两节是同一批内容的工程版说明。

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
| **RustFS (S3)** | 解析产出的图片、上传的原文件 | 二进制对象不适合进数据库 |
| **RabbitMQ** | 发布后的三条索引流水线消息 | 建索引耗时长（embedding + LLM 抽取），必须异步 |

其中最有学习价值的一条是：**Postgres 与 Mongo 是两个独立库，没有跨库事务**。于是写正文的落库顺序被设计成「先写 Mongo → 再写 Postgres → 失败则补偿删除 Mongo」（`src/document/document.service.ts`）。这类"最终一致"的取舍，是第一、二阶段在单库里写 CRUD 时不会遇到的。

**本节配图**

![搭建统一企业知识库，让知识找得到、用得上、解决问题更高效](<agent-imgs/knowledge-hub-img/搭建统一企业知识库，让知识找得到、用得上、解决问题更高效.png>)

![知识库文档存储结构图](<agent-imgs/knowledge-hub-img/知识库文档存储结构图.png>)

![为啥要分开存储，pg 存元数据，mongo 存正文](<agent-imgs/knowledge-hub-img/为啥要分开存储，pg存元数据，mongo存正文.png>)

![MongoDB 文档存储上限是 16MB，超了怎么办](<agent-imgs/knowledge-hub-img/MongoDB文档存储上限是16MB，超了怎么办.jpg>)

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

**本节配图**

![文档状态流转图（需审批流程）](<agent-imgs/knowledge-hub-img/文档状态流转图(需审批流程).png>)

![文档发布](<agent-imgs/knowledge-hub-img/文档发布.jpg>)

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

**本节配图**

![RabbitMQ 消息中间件使用](<agent-imgs/knowledge-hub-img/RabbitMQ消息中间件使用.jpg>)

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

**本节配图**

![Elasticsearch 倒排索引示意图](<agent-imgs/knowledge-hub-img/Elasticsearch 倒排索引示意图.png>)

![基于 Elasticsearch 的混合检索（关键词 + 向量）](<agent-imgs/knowledge-hub-img/基于Elasticsearch 的混合检索(关键词+向量).png>)

![ES 如何实现混合检索](<agent-imgs/knowledge-hub-img/ES如何实现混合检索.png>)

![RAG 混合检索链路（基于用户可见性过滤）](<agent-imgs/knowledge-hub-img/RAG混合检索链路(基于用户可见性过滤).png>)

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

**本节配图**

![Agentic RAG 实现流程图](<agent-imgs/knowledge-hub-img/Agentic RAG 实现流程图.png>)

![Agentic RAG·一次提问的完整路径](<agent-imgs/knowledge-hub-img/Agentic RAG·一次提问的完整路径.png>)

![Agentic RAG 全流程图](<agent-imgs/knowledge-hub-img/Agenttic RAG 全流程图.png>)

![企业级知识库 Agentic RAG & 图谱检索](<agent-imgs/knowledge-hub-img/企业级知识库 Agentic RAG & 图谱检索.png>)

### 六、记忆：记忆不是知识库

会话记忆分三层，每层职责写在名字里：

| 层 | 存储 | 作用 | 失效行为 |
|---|---|---|---|
| 会话历史 | Postgres `kh_ai_session` / `kh_ai_message` | 权威存储，`sources` 用 JSONB 存引用 | 永久 |
| 短期热窗口 | Redis | 最近 20 条（`CHAT_SHORT_MEMORY_MAX_MESSAGES`） | TTL 后不丢历史，下次从 Postgres 回填 |
| 长期记忆 | Mem0（可选） | 跨会话的用户偏好类信息 | 未配 Key 则整体跳过 |

这一节真正要记住的是那条边界：**用户偏好可以记住，制度条文必须以检索结果为准**——不能让"记忆"覆盖"知识库"。记忆层解决的是"懂你"，检索层解决的是"答对"。

**本节配图**

![AI 记忆机制：短期记忆 ~ 长期记忆](<agent-imgs/knowledge-hub-img/AI记忆机制 短期记忆~长期记忆.png>)

![Redis 短期记忆 滑动窗口机制图解](<agent-imgs/knowledge-hub-img/Redis短期记忆 滑动窗口机制图解.png>)

![Mem0 长期记忆](<agent-imgs/knowledge-hub-img/Mem0 长期记忆.png>)

![Mem0 用户提问](<agent-imgs/knowledge-hub-img/Mem0 用户提问.png>)

![会话与消息库表设计](<agent-imgs/knowledge-hub-img/会话与消息库表设计.png>)

![会话与消息 一对多关系（外键级联删除）](<agent-imgs/knowledge-hub-img/会话与消息 一对多关系(外键级联删除).png>)

![什么时候用外键，什么时候不用](<agent-imgs/knowledge-hub-img/什么时候用外键，什么时候不用.png>)

![如何选择是否使用外键（Foreign Key）](<agent-imgs/knowledge-hub-img/如何选择是否使用外键(Foreign Key).png>)

### 七、权限：RBAC 只是入口，可见性下推才是关键

**认证**：JWT 双 token（access 2h / refresh 7d），密码 bcrypt 哈希存储；注册可开启邮箱激活（`REQUIRE_EMAIL_VERIFICATION`），激活 token 与重置验证码都放 Redis 且带 TTL。

**授权**：三个全局守卫按顺序执行：

```
请求 ──► JwtAuthGuard ──► RolesGuard ──► PermissionsGuard ──► Controller
        （是否登录）      （@Roles）      （@RequirePermission）
             └── 标了 @Public() 的接口跳过登录校验
```

权限是「角色权限 OR 直授权限」：用户最终权限 = `kh_user_permission` OR（`kh_user_role` → `kh_role_permission`），ADMIN 额外并入 `ADMIN_OPERATION_PERMISSIONS`。角色只有三个（`ROLE_ADMIN` / `ROLE_REVIEWER` / `ROLE_USER`），权限码分三级（菜单 / 按钮 / 接口），如 `document:list`、`document:create`、`system:permission:edit`。

真正有含金量的是**数据可见性**：规则只写一次（`src/document/document-access.ts`），再下推到三个存储各自的查询语句。

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

`teamIds` 在登录时随 `AuthUser` 放进请求上下文，避免每次查询都回表。这里体现的是第二阶段学不来的东西：**权限不是一个装饰器，而是一条从 HTTP 入口贯穿到索引存储的约束**。

**本节配图**

![RBAC 权限模型](<agent-imgs/knowledge-hub-img/RBAC权限模型.png>)

![RBAC 权限模型（扩展支持用户直赋权限）](<agent-imgs/knowledge-hub-img/RBAC权限模型(扩展支持用户直赋权限).png>)

![RBAC（Role-Based Access Control）](<agent-imgs/knowledge-hub-img/RBAC (Role-Based Access Control).png>)

![三级权限控制模型](<agent-imgs/knowledge-hub-img/三级权限控制模型.png>)

![文档可见性控制](<agent-imgs/knowledge-hub-img/文档可见性控制.png>)

![AccessToken 与 RefreshToken 流程图](<agent-imgs/knowledge-hub-img/AccessToken与RefreshToken流程图.png>)

![用户注册与邮箱激活流程图解](<agent-imgs/knowledge-hub-img/用户注册与邮箱激活流程图解.png>)

![邮箱注册与激活流程图解（示例）](<agent-imgs/knowledge-hub-img/邮箱注册与激活流程图解(示例).png>)

![修改密码流程图解](<agent-imgs/knowledge-hub-img/修改密码流程图解.png>)

### 八、文件解析：两代实现，一次升级

这一节保留两代解析。第一代是项目早期的四个本地解析器（代码仍在 `src/document/parser/parsers/`，主链路已不再调用），第二代是现在跑的 MinerU 精准解析。并排放在一起看，比只写「最终方案」更能说明为什么换。

#### 8.1 第一代：五种格式，四个本地解析器

上传接口用 `FileInterceptor` 接收（限 50MB），`src/document/parser/` 按扩展名分发：

| 类型 | 处理方式 |
|---|---|
| PDF | 文本抽取；图片单独抽出上传 RustFS，正文里替换为图片引用 |
| DOCX | `mammoth` 转 HTML → `turndown` 转 Markdown |
| XLSX | `exceljs` 逐 Sheet 转 Markdown 表格 |
| PPTX | 解析每页文本 |

第一代的问题不是「不能用」，而是上限低：

- PDF 只做文本层抽取，双栏排版会串行、跨页表格会断、公式基本丢失；
- 扫描版 PDF 与图片没有文本层，抽出来是空字符串，只能报「解析结果为空」；
- DOCX 经 HTML 中转能保住标题与段落，但表格结构在 `turndown` 那一步已经变形；
- PPTX 只抠文本框，版式与图片里的信息全部丢弃。

四种格式四套代码，每修一个 corner case 都只对一种格式生效——这是「按格式逐个适配」这条路的天花板。

#### 8.2 第二代：MinerU，一层薄分发 + 一个外部解析服务

现在 `file-parser.service.ts` 只做选路：

| 扩展名 | 处理方式 |
|---|---|
| `pdf` / `png` / `jpg` / `jpeg` / `jp2` / `webp` / `gif` / `bmp` / `doc(x)` / `ppt(x)` / `xls(x)` | MinerU 精准解析（`mineru.parser.ts`） |
| `txt` / `md` | 本地按 UTF-8 直读（`parsePlainText`） |

上传上限同时从 50MB 提到 200MB，与 MinerU 的单文件限制对齐。

交给 MinerU 的不是「抽取文字」，而是「整页转成结构化 Markdown」：请求里带 `model_version: 'vlm'`，页面按图像送进**视觉语言模型**，版式、表格、公式、图内文字一起识别；图片类文件带 `is_ocr: true`，扫描件因此也能出文字；图注与图内文字会随正文进入 `full.md`，图片本身则被裁出来放进 `images/`，由本地转存 RustFS 并改写链接——所以「图里写了什么」同样能被检索到，不再是死数据。

```text
POST /api/v4/file-urls/batch                  申请上传链接（is_ocr、model_version=vlm、enable_formula、enable_table、language=ch）
PUT  uploadUrl                                直传文件，刻意不带 Content-Type，否则签名链接会被拒
GET  /api/v4/extract-results/batch/{batchId}  每 3s 轮询，超时 600s，读 state 与页进度
GET  full_zip_url                             state=done 后下载结果 zip
```

拿到 zip 之后才是本地的事：`JSZip` 里找 `full.md`，把 `images/` 下的图片逐张上传 RustFS，再把 Markdown 中的相对路径替换成 RustFS 地址（兼容 `./images/x.png` 与 `images/x.png` 两种写法），最后 `cleanMarkdown` 收尾。

#### 8.3 两代对比

| 维度 | 第一代 · 本地解析 | 第二代 · MinerU |
|---|---|---|
| 支持格式 | PDF / DOCX / XLSX / PPTX + txt/md | PDF、图片（png / jpg / jpeg / jp2 / webp / gif / bmp）、doc(x)、ppt(x)、xls(x) + txt/md |
| 上传上限 | 50MB | 200MB |
| 解析引擎 | `pdf-parse` / `mammoth` + `turndown` / `exceljs` / 自写 PPTX | 视觉语言模型（`model_version=vlm`） |
| 扫描件与图片 | 无文本层即失败 | `is_ocr: true`，图片与扫描件都能识别 |
| 表格 / 公式 | 表格易变形，公式丢失 | `enable_table` / `enable_formula` 开关保留 |
| 图片处理 | 自己抽图、自己传 RustFS | MinerU 产出 `images/`，本地转存 RustFS 并改写链接 |
| 调用形态 | 同步、进程内 | 异步外部任务（轮询 3s / 超时 600s） |
| 失败面 | 解析异常 | 网络、限流、token、超时、外部服务不可用 |
| 离线可用 | 是 | 否（需要 Token 与公网） |

两句话总结这次升级：第一代赢在「不依赖外部、延迟低」，输在格式覆盖面；第二代把多格式适配整体外包给一个视觉模型，用「异步链路 + 外部依赖」换「扫描件、表格、公式、图片文字都能进来」。复杂度没有消失，只是从「多格式适配」搬到了「外部依赖治理」。

解析结果统一是 Markdown（写 Mongo），元数据（标题、分类、团队、是否公开）写 Postgres。**先把异构文件归一，后面的检索链路才不需要区分来源格式**。

---

**本节配图**

> PDF / DOCX / PPTX / XLSX 四张画于第一代本地解析时期，保留下来与 8.2 的 MinerU 链路对照看；最后一张是改进后的 MinerU 解析流程。

![文件上传与解析保存](<agent-imgs/knowledge-hub-img/文件上传与解析保存.png>)

![PDF 转 Markdown 流程图](<agent-imgs/knowledge-hub-img/PDF 转 Markdown 流程图.jpg>)

![docx 转 Markdown 流程图](<agent-imgs/knowledge-hub-img/docx 转 Markdown 流程图.png>)

![PPTX 转 Markdown 流程图](<agent-imgs/knowledge-hub-img/PPTX 转 Markdown 流程图.jpg>)

![xlsx 转 Markdown 流程图](<agent-imgs/knowledge-hub-img/xlsx 转 Markdown 流程图.jpg>)

![MinerU 解析流程](<agent-imgs/knowledge-hub-img/MinerU解析流程.png>)

### 九、可观测性与评测：把「感觉变好了」变成数字

**先解决两个具体痛点**

到第八节为止，这套系统能跑通、能演示，但有两件事说不清楚：

1. 用户说「答得不对」时，日志里只有最终答案——看不出是意图判错了、召回为空、还是模型自己编的；
2. 想调 rerank 阈值或分块大小，改完没有任何可比基准，只能凭感觉。

解法正是这两块：**tracing** 解决「看得见」，**评测**解决「量得准」。

**可观测性：Langfuse 接在 OpenTelemetry 上**

追踪代码集中在 `src/observability/langfuse.ts`，只做三件事：启动 SDK、关闭 SDK、把一段代码包成 span。

```
main.ts
  startLangfuseTracing()          # NodeSDK + LangfuseSpanProcessor
  process.once('beforeExit', shutdownLangfuseTracing)

业务代码
  withObservation('retrieve-and-grade', async (update) => {
    const r = await retrieveAndGrade(query, user, ...);   // 原逻辑一行没改
    update({ input: { query }, output: { n: r.hits.length } });
    return r;
  })
```

关键取舍是**「不配 Key 就整体空转」**：

```ts
export function isLangfuseEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

export async function withObservation(name, run) {
  if (!isLangfuseEnabled()) return run(() => undefined);   // 直接跑原逻辑
  return startActiveObservation(name, (span) => run((f) => span.update(f)));
}
```

所以业务代码里**没有一处 `if (enabled)`**：观测常开、代价为零。这一点比「怎么上报」更重要——否则没人愿意在热路径上挂监控。

整条链路一共 5 个 span，正好对应五次模型调用：

| span | 位置 | 记了什么 |
|---|---|---|
| `ai-chat` | `ai-chat.service.ts` | 非流式整轮：问题 → 答案 / 意图 / 命中标题 |
| `intent-classify` | `chat-query-rewrite.service.ts` | 意图分类：问题 → 路由计划（本轮开哪些工具） |
| `retrieve-and-grade` | `agentic-retrieve.ts` | 检索-切题循环：实际 query、是否重试、命中数与评分 |
| `retrieve-grade` | `chat-query-rewrite.service.ts` | 逐条命中是否切题 |
| `rewrite-query` | `chat-query-rewrite.service.ts` | 追问改写：原 query → 新 query |

流式链路（`ai-stream.service.ts`）是 LangChain Agent，走的是生态里的 `CallbackHandler`，挂在 `agent.stream(..., { callbacks: [handler] })` 上，tags 打 `['agentic-rag', 意图]`；评测流量额外加 `'eval'` 且不带 sessionId，这样在面板上能把「真人对话」和「跑分」分开看。

**踩到的一个坑：内部调用会被当成回答流**

意图分类、切题评估、追问改写用的是**和回答同一个模型**。它们输出的结构化 JSON 一旦进入 LangChain 的回调链，就会混进流式回答——用户会在答案里看到评测用的 JSON。解决办法是抽一个 `invokeIsolated()`：

```ts
AsyncLocalStorageProviderSingleton.runWithConfig(
  { callbacks: [], tags: ['kh-internal'], metadata: { khInternal: true } },
  run,
  true,   // 不再产生 tracing 根节点
);
```

**评测：9 条金标 + 9 个评测器**

入口是 `pnpm eval:rag`（`src/ai/eval/run-experiment.ts`），三条设计原则：

| 原则 | 做法 | 不这么做会怎样 |
|---|---|---|
| 跑真实链路 | `runForEval()` 复用 `createTurnAgent()`，只把 UI 事件丢给 `silentWriter()`、用 `invoke` 取最终文本 | 评测链路与线上分叉，分数再好看也没意义 |
| 管理员身份 | `EVAL_USER_ID` 默认 `eval-admin`（`ROLE_ADMIN`） | 文档 ACL 会把公开制度也过滤掉，全测成空召回 |
| 金标进代码 | `golden-dataset.ts` 是 TS 常量，与 `agentic-rag.md` 用例对齐 | 金标散在 JSON / 表格里，改动不可评审、容易被绕过 |

9 条金标按 suite 分五类，覆盖的是**行为**而不只是「答对」：

| suite | 例子 | 考的是 |
|---|---|---|
| routing | 「你好」 | 闲聊不该调任何工具 |
| kb-hit | 差旅加签、VPN 账号、发布窗口 | 该召回时召回、要点齐全，且不能串人（`mustNotContain`） |
| rewrite | 加班餐补 | 一次没召回后，有没有真的换 query 再查 |
| kb-empty | 年会抽奖规则 | 库里没有 → 必须拒答、不许编 |
| web | 今日汇率 | 该联网时联网，禁止拿知识库硬答 |

评测器 9 个，**能用规则的绝不用模型**，只有 3 个主观维度交给 LLM 裁判：

| 指标 | 判定 | 裁判 |
|---|---|---|
| `intent_match` | 意图与金标一致 | 规则 |
| `tool_policy` | 按意图校验工具的开 / 禁 | 规则 |
| `rewrite_loop` | 重试了、且新 query ≠ 旧 query | 规则 |
| `hit_at_5` / `precision_at_5` | 前 5 条命中金标标题 / 相关占比 | 规则 |
| `false_hit` | 空金标场景不该有命中 | 规则 |
| `refusal_quality` | 该拒答时拒了、且没编造 | LLM |
| `completeness` | 要点覆盖率；出现禁用事实直接 0 | LLM |
| `groundedness` | supported 1 / mixed 0.5 / fabricated 0 | LLM |

```bash
pnpm eval:rag                                  # 全量 9 条
EVAL_FILTER=kb-hit pnpm eval:rag               # 按 suite
EVAL_FILTER=kb-release-window pnpm eval:rag    # 单条
EVAL_CONCURRENCY=4 pnpm eval:rag               # 并发，默认 2
```

配了 `LANGFUSE_*`，结果就作为 `agentic-rag` experiment 上报，每个分数挂在对应 trace 上，可以对比不同 prompt / 模型 / 参数版本；没配则在终端逐条打印。

还有个小设计：指标返回 `null` 表示「本场景不适用」（闲聊不判忠实度），这种分数**不写进 Langfuse**——否则「跳过」会被当成 0 分，把均值拉歪。

**这一节留下的三条判断**

1. **观测要能零成本接入**：不配 Key 就空转，才敢把它放进主链路；
2. **评测必须跑生产链路**：共用同一个 Agent，评测代码只是「不落库、不推流」；
3. **分数要能表达「不适用」**：`null` 与 `0` 是两件事，混在一起指标就失去解释力。

---

## 第二部分：knowledge-hub-frontend——把能力变成界面

前端的定位很克制：**只负责体验层，真正的权限与可见性拦截仍在后端**，前端隐藏菜单 / 路由只是减少误操作。

### 十、工程与对接：一个 `/api` 代理解决跨域

```
浏览器 ──► Vite dev server :5173 ──/api/*──► http://127.0.0.1:3000/*
                                   （rewrite 去掉 /api 前缀）
```

- 代理配置在 `vite.config.ts`：`/api` → `127.0.0.1:3000`，`changeOrigin: true`，并把**超时设为 0**——问答是长连接流，必须关掉代理超时；
- 后端没有全局路由前缀，所以 `rewrite` 把 `/api` 摘掉；`.env` 里只放 `VITE_API_BASE=/api` 一项；
- `.env` 被仓库根 `.gitignore` 忽略，`client.ts` 用 `import.meta.env.VITE_API_BASE || '/api'` 兜底；
- 生产部署没有内置反代，需要把 `/api` 指向后端或改 `VITE_API_BASE`。技术栈为 React 19 + TypeScript + Vite 8 + Ant Design 6（`zh_CN`）+ React Router 7 + AI SDK v7 + ECharts 6。

**本节配图**

![DTO 与 VO 的区别](<agent-imgs/knowledge-hub-img/DTO与VO的区别.png>)

### 十一、路由与权限：两个包装组件

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

**本节配图**

![AI 知识管理平台 - 前端项目结构与页面路由图解](<agent-imgs/knowledge-hub-img/AI知识管理平台-前端项目结构与页面路由图解.png>)

### 十二、流式问答：接上层协议，而不是自己造

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

**本节配图**

![基于 LangChain Agent + Vercel AI SDK（UI Message Stream Protocol）的流式智能对话架构](<agent-imgs/knowledge-hub-img/基于 LangChain Agent + Vercel AI SDK (UI Message Stream Protocol) 的流式智对话构.png>)

### 十三、图谱可视化：一份数据，两处复用

`components/ForceGraph.tsx` 用 ECharts 力导向布局实现，图谱页与问答内的检索轨迹图共用同一个组件：

| 元素 | 取值 |
|---|---|
| 节点 kind | `document` / `entity` / `tag` |
| 边 kind | `mentions`（文档—实体）/ `related`（实体—实体）/ `tagged` |

前端还有一个值得记住的安全细节：ES 高亮结果经 `safeHighlight` 转义后再放行 `<em>`，避免高亮注入变成 XSS。

**本节配图**

![KG 增强 - 抽取业务实体图谱示例](<agent-imgs/knowledge-hub-img/KG增强-抽取业务实体图谱示例.png>)

---

## 十四、文档互动与站内通知：一条跨前后端的业务闭环

前面十三节讲的是「知识怎么进来、怎么被找到」。真实系统还有另一半：文档不只是被检索的对象，读者会点赞、收藏、评论，会把链接发给同事，作者需要知道「有人评论了我的文档」。这块代码的技术密度不高，但它是唯一一条把**权限、可见性、通知、公开分享与前端状态**串起来的完整闭环，值得单独看一眼。

### 14.1 七张新表，一个原则

| 表 | 作用 | 关键约束 |
|---|---|---|
| `kh_category` | 分类树（`parent_id` 自引用 + `deleted` 逻辑删除） | 文档只能挂到未删除的分类 |
| `kh_comment` | 评论（两级，`parent_id` 指向父评论） | 不做无限嵌套 |
| `kh_document_like` / `kh_document_favorite` | 点赞 / 收藏 | `UNIQUE (document_id, user_id)` |
| `kh_document_share` | 分享链接 | `token` 唯一，`expire_at` / `revoked` / `password_hash` 决定是否可用 |
| `kh_document_version` | 正文快照 | `UNIQUE (document_id, version)`，回滚是追加新版本而非覆盖 |
| `kh_notification` | 站内通知 | `type` = like / comment / system，`is_read` 决定未读数 |

那条 `UNIQUE` 不是洁癖：点赞是并发高频操作，有了唯一约束就能靠 `ON CONFLICT DO NOTHING` 直接写，不必「先查再写」——后者才是并发下重复点赞的真正来源。

### 14.2 一条评论要经过哪些人

```
POST /documents/:id/comments
  ├─ RequirePermission('document:list')   权限在入口就把住
  ├─ 可见性校验：复用 document-access 的规则，不另写一套
  ├─ 写 kh_comment（user_name 冗余一份，列表不用 join 用户表）
  └─ 通知作者：写 kh_notification（作者本人操作则跳过）
```

三个取舍：

1. **自己点赞 / 评论自己的文档不发通知**（`doc.authorId === actor.userId` 直接 return），否则通知列表全是自己的操作记录。
2. **通知只是一张表，不是消息队列**：写库 + 前端轮询 `/notifications/unread-count`。够用，也省掉 WebSocket 的长连接与断线重连。
3. **通知失败不阻塞主流程**：通知是附带动作，不能让一次评论因为通知异常而 500。

### 14.3 分享链接：把鉴权从登录态里摘出来

分享是唯一需要**免登录访问**的业务接口，所以它用了全局 Guard 的 `@Public()` 例外，并拆成两步：

```
POST /documents/:id/shares   登录 + document:list，生成 token（可选密码 → bcrypt 存 hash）
GET  /shares/:code           公开，只回「是否有效 / 是否需要密码」，不回正文
POST /shares/:code/access    公开，密码校验通过才回正文
```

拆成两个公开接口是为了前端体验：先渲染「这条分享需要密码」，再让用户输入。密码比对用 bcrypt、库里只存 hash；过期与关闭都靠字段判断而不删行，事后还能查「这条链接是谁建的」。

### 14.4 前端对应部分

| 位置 | 文件 | 做什么 |
|---|---|---|
| 详情页互动区 | `DocumentDetailPage.tsx` | 点赞 / 收藏 / 评论（两级）/ 分享弹窗 / 版本入口 |
| 我的收藏 | `FavoritesPage.tsx` | `GET /favorites` 分页 |
| 版本历史 | `DocumentVersionsPage.tsx` | 列表 + 回滚 |
| 通知中心 | `NotificationsPage.tsx` + `AppLayout.tsx` 顶栏铃铛 | 列表 + 未读数轮询 |
| 免登录分享页 | `SharePage.tsx` | `/share/:code`，不套 `AppLayout`、不过登录守卫 |
| 分类维护 | `pages/admin/CategoriesPage.tsx` | 分类树 CRUD |

一个贯穿的做法：**互动类接口都是「后端算好、前端只渲染」**——点赞返回最新计数、收藏返回最新状态、通知带 `isRead`，前端不做乐观更新，就少一处状态不一致的来源。

**本节配图**

![知识库产品体验功能增强](<agent-imgs/knowledge-hub-img/知识库产品体验功能增强.png>)

---

## 十五、总结

### 15.1 第三阶段究竟交付了什么？

| 维度 | 第一 / 第二阶段 | 第三阶段 |
|---|---|---|
| 形态 | 独立脚本、独立服务、独立演示 | 一个业务系统的前后端 |
| 数据 | 单库或单一检索库 | 七种存储按数据形态分工，跨库最终一致 |
| 检索 | 能召回 | 召回 → 融合 → 精排 → 引用，且每环可降级 |
| 问答 | 一次调用 | Agentic RAG：意图 → 检索 → 评估 → 改写 → 联网 |
| 权限 | 接口级装饰器 | RBAC + 可见性规则下推到 PG / ES / Neo4j |
| 交付 | "能跑给你看" | 能登录、能上传、能审核、能互动（点赞/收藏/评论/分享）、能检索、能问、能管 |
| 观测与评测 | 靠日志和感觉 | 5 个 span 的全链路 tracing + 9 条金标可重复跑分 |

一条贯穿全项目的主线是：**前面学的是"让每块能力跑起来"，这一阶段学的是"让它们互相约束着一起跑"**——索引要跟着状态走，权限要跟着数据走，记忆不能越权替知识库说话。

### 15.2 四条认识链的终点

把三个阶段连起来，四条主线的演进是完整的：

```
工程形态：.mjs 脚本 → NestJS 服务（SSE/DI/Swagger）→ 多存储协同的业务系统 + React 管理台
编排方式：手写 ReAct → LCEL → LangGraph 图 → createAgent → 中间件 → Agentic RAG（工具 + 评估 + 有限重试）
检索能力：向量召回 → 混合检索 + Rerank → GraphRAG → 双路并行 + RRF + 阈值 + 引用出处 + 可见性过滤
记忆体系：截断/总结/检索 → Redis 短期 + Mem0 长期 + LangGraph checkpointer → 三层记忆并明确"记忆 ≠ 知识库"
权限边界：无 → 单接口鉴权 → 三角色 + 三级权限码 + 三存储可见性下推
观测评测：无 → 翻日志排查 → Langfuse tracing（5 个 span）+ 9 条金标 RAG 评测
```

### 15.3 已知限制（写在文档里，比藏在代码里好）

后端：无跨库事务（靠补偿删除保证最终一致）；索引是最终一致（刚发布立刻搜不到属预期）；MQ 无重试与死信队列；图谱抽取依赖 LLM；表结构仍靠 `init.sql` + 手工增量脚本（`migrate-social-notification.sql`），没有版本化迁移工具；`document-status.ts` / `document-access.ts` 是纯函数却仍未补单测；评测只有 9 条金标（够冒烟与回归、不够统计结论），judge 与答题同源模型存在自评偏置，也未接 CI。

前端：token 存 localStorage 有 XSS 风险（更稳的是 httpOnly Cookie + CSRF）；无自动化测试，只有 oxlint 与手工验证；问答流未做断线重连；站内通知只覆盖点赞 / 评论 / 系统广播，审核结果仍无通知，也没有 WebSocket 推送（靠轮询未读数）。

### 15.4 一句话收尾

第一阶段学会的是"**用 LangChain 把大模型变成工业流水线**"；第二阶段学会的是"**把流水线装进真实系统**"；第三阶段学会的是"**把系统变成一个别人真能用的东西**"——文档进得去、知识找得到、答案有出处、权限管得住、效果量得准。到这里，仓库不再是一堆示例的集合，而是一个能交付、也能说清哪里还没做好的项目。
