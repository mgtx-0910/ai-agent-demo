# AI Agent 全栈开发学习

基于 [LangChain](https://www.langchain.com/) / LangGraph / DeepAgents 的 AI Agent 全栈开发学习项目：从基础组件到 LCEL 工业流水线，再到工程化落地与生产级 Agent 应用。

> [📖 第一阶段学习总结](docs/LangChain-AI-Agent-第一阶段学习总结.md) — LangChain 组件 → LCEL 工业流水线（2026-06-27 ~ 07-22）
>
> [📖 第二阶段学习总结](docs/LangChain-AI-Agent-第二阶段学习总结.md) — 工程化落地 → 图编排 → 生产级 Agent（2026-07-29 ~ 09-08）

---

## 项目结构

```js
├── docs/                        # 📚 学习文档
│   ├── LangChain-AI-Agent-第一阶段学习总结.md
│   └── LangChain-AI-Agent-第二阶段学习总结.md
├── 📦 第一阶段 · 入门 Agent（2026-06-27 起）
├── tool-test/                   # 🔧 Tool & MCP — 工具定义与 Agent 循环
├── rag-test/                    # 🔍 RAG — 检索增强生成  
├── milvus-test/                 # 🗄️ Milvus — 向量数据库实战      
├── memory-test/                 # 🧠 Memory — 对话记忆管理
├── output-parser-test/          # 📤 OutputParser — 结构化输出控制   
├── prompt-template-test/        # 🏷️ PromptTemplate — 模块化 Prompt 管理
├── runnable-test/               # ⛓️ LCEL — Runnable 声明式编排
│
├── 📦 第二阶段 · 工程化与生产级 Agent（2026-07-29 起）
├── hello-nest-langchain/        # NestJS 集成 LangChain
├── cron-job-tool/               # Agent + 定时任务 + MySQL
├── tts-stt-test/                # 腾讯云语音能力沙盒
├── asr-and-tts-nest-service/    # ASR → AI → TTS 服务
├── agui-backend/                # AI Agent 后端（AI SDK）
├── agui-frontend/               # AI Agent 前端（React）
├── langgraph-test/              # LangGraph 图编排
├── advanced-rag/                # 高级 RAG
├── es-test/                     # ES 混合检索 + Rerank
├── neo4j-graphrag/              # Text2Cypher GraphRAG
├── langsmith-test/              # LangSmith 评测
├── deepagents-test/             # DeepAgents 中间件
├── deep-research-assistant/     # 深度调研助手
├── pgsql-test/                  # PostgreSQL + pgvector
├── redis-test/                  # Redis 记忆
├── mem0-test/                   # Mem0 记忆平台
```

## 第一阶段项目介绍（2026-06-27 起 · 入门 Agent）

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

## 第二阶段项目介绍（2026-07-29 起 · 工程化与生产级 Agent）

> 📖 完整讲解见 [第二阶段学习总结](docs/LangChain-AI-Agent-第二阶段学习总结.md)

**阶段主题**：从 `.mjs` 脚本升级为可服务的 Web 应用；用 LangGraph 把"链"升级为"图"；把检索做到生产级（路由 / 混合 / 图谱 / 评测）；补全记忆与存储体系。

### 1. hello-nest-langchain — NestJS 工程化集成

LangChain 与 NestJS 工程化集成的起点，第一篇"把脚本变成服务"的实践。

- **DI 工厂注入大模型** — `CHAT_MODEL` + `useFactory`，配 ConfigService 从 `.env` 读取，换厂商只改配置
- **`@Sse` 流式问答** — 把 Runnable 链封装成 SSE 接口，逐 chunk 推送
- **Swagger + OpenAPI** — 启动挂载 `/api-docs`，可导出接口文档
- **REST 分层参考** — Book 模块的 Controller / Service / Repository / DTO，内存仓库可换 TypeORM

### 2. cron-job-tool — Agent + 定时任务 + MySQL

让 Agent 拥有"行动力 + 时间"：用户一句话，AI 自己拆步骤、调工具、登记定时任务。

- **双 Agent** — 对话 Agent（6 工具）+ 任务 Agent（4 工具，刻意排除 `cron_job` 防递归）
- **手写 ReAct 循环** — `tool_calls → 执行 → ToolMessage → 再 invoke` 直到无 tool_calls
- **工具三层封装** — `tool()` 服务 → `useFactory` 导出 token → `@Inject` 聚合绑定模型
- **三类定时任务** — `@nestjs/schedule` 的 CronJob / every / at，重启自动恢复
- **TypeORM + MySQL** — zod 工具校验、forwardRef 化解循环依赖

### 3. tts-stt-test — 腾讯云语音能力沙盒

先验证再集成，不含框架的纯脚本级语音能力演练。

- **一句话 TTS** — 官方 SDK `TextToVoice`，Base64 写 mp3
- **流式 TTS** — WebSocket `stream_wsv2`，手工实现 TC3-HMAC-SHA1 WebSocket 签名
- **一句话 ASR** — `SentenceRecognition`，Base64 → `SourceType=1`
- **闭环验证** — 把合成的 mp3 再喂给 ASR，验证"合成 → 识别"保真度

### 4. asr-and-tts-nest-service — ASR → AI → TTS 全链路

把语音装进服务，打通"语音 → 文本 → AI 作答 → 语音"。

- **SSE + WebSocket 双通道** — 文字走 SSE、音频 mp3 分片走自建 WS
- **事件总线解耦** — `@nestjs/event-emitter`，AiModule 与 SpeechModule 互不 import
- **`ttsSessionId` 关联** — 一条 WS 连接 ↔ 一条 SSE 流
- **边生成边合成** — chunk 并行发 SSE 与 TTS，未就绪进 `pendingChunks` 缓存后 flush
- **流式 TTS 协议** — `ACTION_SYNTHESIS`（逐段）→ `ACTION_COMPLETE`（结束）

### 5. agui-backend — AI Agent 后端（AI SDK）

用 Vercel AI SDK 统一交互协议，后端只输出标准 UIMessage 流。

- **`createAgent` 高层封装** — 一行构建带工具循环的 Agent，替代手写 ReAct
- **UIMessage 桥接** — `toBaseMessages` / `toUIMessageStream`，前端 `{role, parts[]}` 回传
- **`pipeUIMessageStreamToResponse`** — 直写 SSE 响应
- **工具 DI 注入** — `WEB_SEARCH_TOOL`（博查）+ `SEND_MAIL_TOOL`（SMTP）
- **`streamMode` / `recursionLimit`** — 控制输出与递归上限

### 6. agui-frontend — AI Agent 前端（React）

AI 对话前端，把工具调用"演"出来，与后端协议完全对齐。

- **React 19 + `useChat`** — `DefaultChatTransport` 一键接 SSE
- **`parts` 分片段渲染** — text 交给 Streamdown 流式 Markdown（高亮 + Mermaid）
- **工具调用可视化** — 状态机 `input-streaming → input-available → output-available/output-error`
- **搜索 / 发邮件卡片** — 实时展示参数生成、进度与结果

### 7. langgraph-test — LangGraph 图编排

从 LCEL 静态链升级到 LangGraph 状态图，是第二阶段编排范式的基石。

- **状态即黑板** — `Annotation` 声明状态，reducer 定义合并规则（追加 / 覆盖）
- **条件路由 + 循环重试** — `addConditionalEdges`
- **checkpointer** — MemorySaver 跨轮累加 / SqliteSaver 落盘重启恢复
- **`interrupt()` 暂停等审批** — `Command.resume` 续跑
- **Agent 工具循环** — prebuilt `ToolNode` / `createAgent`
- **多智能体四方案** — supervisor → postModelHook 截断 → 结构化路由 → `Send` 并行扇出

### 8. advanced-rag — 高级 RAG

让 RAG 会"判断、循环、回退"，从一条线变成一张图。

- **查询路由** — 先判断直接答还是检索（`withStructuredOutput`）
- **多跳 / Plan-and-Execute** — 拆子问题 → 检索 → 规划判断够没 → 不够循环（`MAX_HOPS` 上限 + content 去重）
- **本地不足联网回退** — `retrieve_local → evaluate → web_search → generate`，只回退一次
- **状态白名单制的坑** — 节点返回未声明字段会被静默丢弃

### 9. es-test — ES 混合检索 + Rerank

中文检索 + 混合召回 + 重排，搭建生产级 RAG 链路。

- **ES8 + IK 分词** — 索引 `ik_max_word` / 搜索 `ik_smart`（analyzer 与 search_analyzer 分开）
- **LangGraph 六节点混合检索** — 查询扩展 → ES 全文 + Milvus 向量并行 → 按业务 id 去重 → Rerank → 生成
- **双库并行** — 多条边自动并行，`addEdge([...], "merge")` 双路汇合
- **自定义 Rerank** — 继承 `BaseDocumentCompressor` 接 DashScope 排序
- **种子双写 + L2≈余弦** — embedding 归一化后 L2 距离平方 = 2 − 2·cosθ

### 10. neo4j-graphrag — Text2Cypher GraphRAG

用知识图谱应对"关系精确、需多跳"的问题，与向量 RAG 互补。

- **图谱构建** —（奶茶主题）Product / Type / Ingredient / People 节点 + `属于/包含/适合/使用` 关系
- **Text2Cypher** — LLM 把问题翻译成 Cypher，执行结果进上下文再生成
- **Schema 注入 prompt** — 降低方向写反 / 多跳连错概率
- **坏 Cypher 不中断** — 异常兜底"未查询到相关知识"，`temperature=0` 防编造
- **`neo4j-driver` 直连** — 底层增删改查，与 LangChain 封装对照

### 11. langsmith-test — LangSmith 可观测与评测

给 Agent 装上"质检仪"，从黑盒执行到可量化评测。

- **RAG 应用** — `RecursiveCharacterTextSplitter(500/50)` + `text-embedding-v3` 入 Milvus
- **LangGraph 检索图** — `retrieve → generate`，system prompt 硬约束防幻觉
- **OpenEvals 三指标** — 忠实度 / 有用性 / 相关性（LLM-as-Judge，0~1 连续分）
- **评测闭环** — `build_dataset` → `evaluate` 生成 experiment，上报 LangSmith 可横向对比

### 12. deepagents-test — DeepAgents 中间件

拆解 createAgent 背后的"增强层"，理解 Agent 为何可插拔。

- **手写中间件** — `beforeAgent / afterAgent / beforeModel / afterModel / wrapModelCall / canJumpTo('end')`
- **官方五大中间件** — Filesystem、Memory、Skills、Subagent、Summarization
- **文件系统** — `virtualMode + permissions`（先匹配先生效、未命中默认放行，越权反馈 `permission denied`）
- **两级记忆** — 项目级 `AGENTS.md` + 用户级 `preferences.md`，每轮作为 `<agent_memory>` 注入
- **子 Agent 委派** — 主 Agent 持 `task` 工具按 `description` 挑选

### 13. deep-research-assistant — 深度调研助手

把前面所有能力组装成一个能独立交付工作的深度调研 Agent。

- **`createDeepAgent` 全家桶** — 文件系统 + 记忆 + 技能 + 子 Agent 一次组装
- **三个子 Agent** — researcher（≤3 次搜索）/ analyst（QuickJS eval REPL 算数）/ editor（只审不改）
- **关闭通用兜底子 Agent** — `generalPurposeSubagent: { enabled: false }` 保流程纪律
- **调研流程** — 规划 → research_plan.md → 并行调研 → 分析 → 起草 draft → 审稿 → 定稿
- **CLI 流式** — `streamMode: 'updates'` + `subgraphs: true` 打印各子 Agent 步骤

### 14. pgsql-test — PostgreSQL + pgvector

让关系库"长出"向量检索能力，一条 SQL 同时承载业务存储与语义检索。

- **三级结构** — user → conversation → message（外键 `ON DELETE CASCADE`）
- **`embedding vector(1024)` 列** — HNSW 索引（`vector_cosine_ops`）
- **余弦距离检索** — `1 - (embedding <=> $1::vector)`，按距离升序 limit
- **`$1/$2` 参数化** — 防注入，更新时同步重算 embedding

### 15. redis-test — Redis 记忆

Redis 基础知识 + 把它当 Agent 的短期记忆。

- **五大类型** — String / Hash / List / Set / ZSet + 分布式锁 `set(..., 'NX','EX',10)`
- **短期记忆三层** — Key `agent:short_memory:<sessionId>:messages`、TTL 30min 自动遗忘、换 sessionId 隔离
- **StoredMessage 序列化** — `mapChatMessagesToStoredMessages` / `mapStoredMessagesToChatMessages` 往返
- **摘要压缩** — 超 8 条自动总结、保留最近 4 条（`lc_source="summarization"`）

### 16. mem0-test — Mem0 记忆平台

Mem0 是"记忆即平台"，加记忆只需调 API，抽取 / 去重 / 更新由服务端完成。

- **云端 API** — `add / search / getAll / get / update / history / deleteAll`
- **三种 scope** — `user_id`（跨会话）/ `run_id`（单任务）/ `agent_id`（Agent 自身）
- **本地部署** — docker + OpenAPI（`POST /memories`、`POST /search`），自写 `LocalMem0Client`
- **分层记忆 Agent** — Redis 短期 + Mem0 user 长期 + Mem0 session 任务，记忆分类器写回

---

## 第一阶段学习时间线

```
Tool & MCP         RAG           Milvus      Memory      OutputParser    PromptTemplate    LCEL
   │                │              │           │              │               │            │
 06-27            06-30          07-10       07-15          07-17           07-21        07-22
   │                │              │           │              │               │            │
   └─ Agent 行动     └─ 知识增强    └─ 向量DB   └─ 上下文管理  └─ 输出控制    └─ 输入控制     └─ 工业化编排
```

学完组件 → **工具集**，学完 LCEL → **工业流水线**。

### 第二阶段学习时间线

```text
📦 工程化落地（07-29 → 08-19）
  hello-nest-langchain    cron-job-tool    语音(tts-stt+asr-and-tts)   agui-backend/frontend
        07-29                08-10                08-17                       08-19
        └─ 脚本 → NestJS Web 服务：DI + SSE + 工具化 + AI SDK 协议

📦 图编排 + 检索生产化（08-19 → 09-02）
  langgraph-test      advanced-rag       es-test      neo4j-graphrag     langsmith-test
      08-19              08-25            08-27           09-01              09-02
      └─ 链 → 图；RAG → 路由 / 多跳 / 混合检索 / 图谱 / 评测

📦 框架深水区 + 记忆体系（09-02 → 09-08）
  deepagents-test    deep-research-assistant   pgsql-test/redis-test     mem0-test
       09-02                  09-03                  09-04                 09-07
       └─ 中间件机制 → 综合实战 → 存储与分层记忆
```

第一阶段学的是"让大模型变成工业流水线"；第二阶段把流水线装进真实系统——能上图编排、能生产级检索与评测、有分层记忆、会语音、能定时干活。

---

## 技术栈

- **Runtime**: Node.js 24+
- **AI 框架**: LangChain.js (`@langchain/core` / `@langchain/openai` / `@langchain/community`)、LangGraph (`@langchain/langgraph`)、DeepAgents (`deepagents`)
- **后端框架**: NestJS 11（DI / SSE / WebSocket / 定时任务 / TypeORM）
- **语音**: 腾讯云 TTS / ASR（TC3 WebSocket 签名）
- **消息协议**: Vercel AI SDK（`ai` / `@ai-sdk/react` / `@ai-sdk/langchain`）
- **检索与存储**: Milvus、Elasticsearch（IK 分词）、Neo4j、PostgreSQL（pgvector）、Redis、MySQL
- **记忆**: Mem0（`mem0ai`）
- **可观测 / 评测**: LangSmith、OpenEvals
- **Schema**: Zod
- **包管理**: npm / pnpm / fnm（Node 版本管理）
