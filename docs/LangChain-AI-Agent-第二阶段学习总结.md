# LangChain AI Agent 第二阶段学习总结：从 Demo 到生产级 Agent

## 概述

第一阶段我们学完了 LangChain 的各大组件，并用 **LCEL** 把它们串成了"工业流水线"。但那时的成果主要是 `.mjs` 脚本：

- 进程一退出，状态全没了；
- 没有 HTTP 接口，只能本地跑；
- 检索库单点（Milvus）、没有评测、Agent 循环全靠手写。

第二阶段要解决的就是这三个问题——**把脚本变成服务、把链变成图、把检索/记忆做到生产级**。本阶段共沉淀 **16 个子项目**：

| 序号 | 子项目 | 首次提交 | 主题 |
|------|--------|----------|------|
| ① | `hello-nest-langchain` | 2026-07-29 | NestJS 工程化：LangChain 第一次进 Web 服务 |
| ② | `cron-job-tool` | 2026-08-10 | Agent + 工具 + 定时调度 + MySQL 持久化 |
| ③ | `tts-stt-test` | 2026-08-17 | 腾讯云语音能力沙盒（TTS / 流式TTS / ASR） |
| ④ | `asr-and-tts-nest-service` | 2026-08-17 | ASR → AI → TTS 全链路流式中继服务 |
| ⑤ | `agui-backend` | 2026-08-19 | Vercel AI SDK 消息协议（UIMessage）后端 |
| ⑥ | `agui-frontend` | 2026-08-19 | AI Agent 对话前端（流式 Markdown + 工具可视化） |
| ⑦ | `langgraph-test` | 2026-08-19 | LangGraph 图编排（状态图 / 多智能体） |
| ⑧ | `advanced-rag` | 2026-08-25 | 高级 RAG：查询路由 / 多跳 / 联网回退 |
| ⑨ | `es-test` | 2026-08-27 | Elasticsearch + Milvus 混合检索 + Rerank |
| ⑩ | `neo4j-graphrag` | 2026-09-01 | Text2Cypher 型 GraphRAG（知识图谱） |
| ⑪ | `langsmith-test` | 2026-09-02 | LangSmith 可观测性与 LLM-as-Judge 评测 |
| ⑫ | `deepagents-test` | 2026-09-02 | DeepAgents 中间件机制拆解 |
| ⑬ | `deep-research-assistant` | 2026-09-03 | 深度调研助手（DeepAgents 综合实战） |
| ⑭ | `pgsql-test` | 2026-09-04 | PostgreSQL + pgvector 向量检索 |
| ⑮ | `redis-test` | 2026-09-04 | Redis 基础 + Agent 短期记忆落地 |
| ⑯ | `mem0-test` | 2026-09-07 | Mem0 记忆平台（云端 / 本地 / 分层记忆） |

> 所有日期取自仓库中**各子项目目录首次提交**的时间。第一阶段总结（2026-07-27 提交）与第二阶段第一个项目 `hello-nest-langchain`（2026-07-29）之间无缝衔接。

```
波次一 · 工程化落地（07-29 → 08-19）      波次二 · 图编排 + 检索生产化（08-19 → 09-02）      波次三 · 框架深水区 + 记忆体系（09-02 → 09-08）
┌──────────────────────────────────┐   ┌───────────────────────────────────────────┐   ┌──────────────────────────────────────────────┐
│ hello-nest-langchain   07-29      │   │ langgraph-test         08-19               │   │ deepagents-test           09-02              │
│ cron-job-tool          08-10      │   │ agui-backend/frontend  08-19               │   │ deep-research-assistant   09-03              │
│ tts-stt-test           08-17      │   │ advanced-rag           08-25               │   │ pgsql-test                09-04              │
│ asr-and-tts-nest-svc   08-17      │   │ es-test                08-27               │   │ redis-test                09-04              │
│     脚本 → Web 服务                 │   │ neo4j-graphrag         09-01               │   │ mem0-test                 09-07              │
│     （Nest + SSE + 工具化）          │   │ langsmith-test         09-02               │   │     中间件 / 分层记忆 / 存储                 │
└──────────────────────────────────┘   │     链 → 图；RAG → 生产级                     │   └──────────────────────────────────────────────┘
                                       └───────────────────────────────────────────┘
```

下面按这三波次展开。

---

## 波次一：工程化落地——把 AI 装进 Web 服务

第一阶段全是在 Node 脚本里 `await model.invoke(...)`。第二阶段做的第一件事，就是**把这些能力搬进真正的后端框架 NestJS**，让大模型变成服务里的一个"可注入依赖"。

### 一、hello-nest-langchain：NestJS 集成起点

这个项目是第一阶段与第二阶段的"桥"。代码结构上是教科书式的 Nest 三层：**AI 对话模块**（普通问答 + SSE 流式）与 **Book 图书 CRUD 模块**（RESTful 分层参考）。

#### 1.1 大模型如何注入？—— DI 工厂 Provider

LangChain 的 `ChatOpenAI` 需要模型名、Key、BaseURL，而这些都来自 `.env`（配的是 DashScope 的 OpenAI 兼容端点，可以跑通千问）。Nest 里最标准的做法是**字符串 token + `useFactory` 工厂注入**：

```ts
// ai.module.ts —— 把"大模型"做成一个可替换的依赖
@Module({
  providers: [
    {
      provide: 'CHAT_MODEL',                                    // 字符串 token
      useFactory: (config: ConfigService) => new ChatOpenAI({
        modelName: config.get<string>('MODEL_NAME'),
        apiKey: config.get<string>('OPENAI_API_KEY'),
        configuration: { baseURL: config.get<string>('OPENAI_BASE_URL') },
      }),
      inject: [ConfigService],                                  // 注入配置服务
    },
    AiService,
  ],
})
export class AiModule {}
```

使用方只需要 `@Inject('CHAT_MODEL')` 就能拿到模型实例。换模型/换厂商只改 `.env`，业务代码零改动——这正是第一阶段反复强调的"屏蔽底层差异"在工程层的落实。**第一阶段我们用 LangChain 屏蔽大模型差异，第二阶段用 Nest DI 把 LangChain 本身也变成可替换依赖。**

#### 1.2 输出怎么流？—— SSE 接口

把第一阶段的 Runnable 链搬进来，普通接口一行 `invoke`，流式接口用 Nest 的 `@Sse`：

```ts
// ai.controller.ts —— SSE 流式接口
@Sse('chat/stream')
chatStream(@Query('query') query: string): Observable<MessageEvent> {
  return from(this.aiService.streamChat(query)).pipe(
    map((chunk) => ({ data: chunk })),   // 每段文本包一层 { data }
  );
}
```

`@Sse` 接受一个 RxJS `Observable`，Nest 自动把每个发射值编码成 `data: ...\n\n`。前端用浏览器原生 `EventSource` 就能消费（项目里附了 `public/sse-test.html` 手工测试页）。

#### 1.3 文档化与分层

- 启动时挂载 **Swagger**（`/api-docs`），另有独立脚本把接口导出成 `openapi.json`；
- `book` 模块演示 **Controller → Service → Repository → DTO/Entity** 的标准分层，内存仓库通过 `BOOK_REPOSITORY` token 注入，将来可无缝换成 TypeORM。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../hello-nest-langchain/src/ai/ai.module.ts`](../hello-nest-langchain/src/ai/ai.module.ts) | CHAT_MODEL 工厂注入 |
> | [`../hello-nest-langchain/src/ai/ai.controller.ts`](../hello-nest-langchain/src/ai/ai.controller.ts) | 普通 + `@Sse` 流式接口 |
> | [`../hello-nest-langchain/src/ai/ai.service.ts`](../hello-nest-langchain/src/ai/ai.service.ts) | Prompt→Model→Parser 的 Runnable 链 |
> | [`../hello-nest-langchain/src/book/`](../hello-nest-langchain/src/book/) | RESTful CRUD 分层参考 |

---

### 二、cron-job-tool：让 Agent 拥有"行动力 + 时间"

`hello-nest-langchain` 只是个问答服务。**Agent 和"问答"最大的区别是有工具、能行动、按计划执行**。这个项目把 Agent 做成一个"听懂人话、自己规划步骤、还能定时自动干活"的服务：用户用自然语言说一句"帮我查用户张三的邮箱，发一封通知邮件，然后每天 9 点跑一次统计数据"，AI 自己拆步骤、调工具、把任务登记成定时任务，到点后由**后台任务 Agent** 自动执行。

#### 2.1 双 Agent 架构

| Agent | 面向谁 | 绑定工具 | 关键设计 |
|-------|--------|----------|----------|
| 对话 Agent（`AiService`） | 用户 | 6 个：查用户/发邮件/联网搜索/MySQL CRUD/取时间/建定时任务 | 负责理解意图、执行当下动作、登记未来任务 |
| 任务 Agent（`JobAgentService`） | 定时任务 | 4 个（刻意**不含** `cron_job`、`query_user`） | 到点后执行任务里存的 `instruction` |

两个 Agent 都用**第一阶段手写的 ReAct 循环**：`invoke → 检查 tool_calls → 逐个执行 → ToolMessage 追加 → 再 invoke`，直到没有 tool_calls。

第二个 Agent 故意**排除 `cron_job` 工具**——防止任务 Agent 执行时又递归地建新任务；排除 `query_user` 是因为演示用户数据在内存，重启即失。**给不同角色的 Agent 配不同的工具集，是权限最小化的雏形。**

#### 2.2 工具在 Nest 中的"三层封装"

工具要同时被 Controller 的 Agent 循环用、又要走 DI，所以做了三层：

```ts
// 第 1 层：@Injectable 服务里用 LangChain 的 tool() 定义工具
@Injectable()
export class TimeNowToolService {
  tool = tool(() => new Date().toLocaleString('zh-CN'), {
    name: 'time_now',
    description: '获取当前时间',
    schema: z.object({}),
  });
}

// 第 2 层：Module 里把服务里的 .tool 导出为字符串 token
{ provide: 'TIME_NOW_TOOL', useFactory: (s: TimeNowToolService) => s.tool, inject: [TimeNowToolService] }

// 第 3 层：Agent 服务 @Inject 多个 token，聚合成数组绑给模型
```

这样"**工具即依赖**"，想给某个 Agent 加/减工具，改 Module 的 providers 即可，与上一节的 CHAT_MODEL 思路完全一致。

#### 2.3 三类定时任务

用 `@nestjs/schedule` 的 `SchedulerRegistry` 动态注册，以任务 id 为 key：

| 类型 | 底层实现 | 适用 |
|------|----------|------|
| `cron` | `CronJob`（6 段带秒表达式） | 固定周期，如 `0 0 9 * * *` |
| `every` | JS `setInterval` | 简单毫秒间隔 |
| `at` | JS `setTimeout` | 一次性延迟执行，触发后自动从注册表移除 |

服务启动时 `onApplicationBootstrap()` 会从 MySQL 里把 `isEnabled=true` 的任务捞出来重新注册——**重启后定时任务自动恢复**。

#### 2.4 持久化与提示词工程

- 任务、用户数据落 **MySQL（TypeORM）**，工具参数校验用 zod、接口 DTO 校验用 class-validator；
- 模块之间出现 Tool ↔ Job 循环依赖时用 `forwardRef` 解决；
- 系统提示词里明确写"未来动作只登记不执行""instruction 只填自然语言不填脚本"等规则，从源头约束 LLM 的行为边界。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../cron-job-tool/src/ai/ai.service.ts`](../cron-job-tool/src/ai/ai.service.ts) | 对话 Agent（手写 ReAct 循环） |
> | [`../cron-job-tool/src/ai/job-agent.service.ts`](../cron-job-tool/src/ai/job-agent.service.ts) | 后台任务 Agent |
> | [`../cron-job-tool/src/tool/`](../cron-job-tool/src/tool/) | 工具服务 + 三层封装 |
> | [`../cron-job-tool/src/job/job.service.ts`](../cron-job-tool/src/job/job.service.ts) | 定时任务注册/恢复 |
> | [`../cron-job-tool/src/users/`](../cron-job-tool/src/users/) | TypeORM + MySQL CRUD 参考 |

---

### 三、语音能力：ASR → AI → TTS 全链路

这一阶段补上了"耳朵和嘴巴"：先用 **`tts-stt-test`** 这个无框架的脚本沙盒验证腾讯云语音能力，再在 **`asr-and-tts-nest-service`** 里封装成"语音识别 → AI 流式作答 → 语音合成"的完整服务。

#### 3.1 先做沙盒验证（tts-stt-test）

`asr-and-tts-nest-service` 里 TTS 中继的签名逻辑与协议，全部源自这个沙盒项目的验证：

| 脚本 | 能力 | 关键点 |
|------|------|--------|
| `tts-test.mjs` | 一句话合成 | 官方 SDK `TextToVoice`，返回 Base64 → 写 mp3 |
| `streaming-tts-test.mjs` | 流式合成 | 不走 REST，连 WebSocket `stream_wsv2`；手工实现**腾讯云 TC3-HMAC-SHA1 WebSocket 签名** |
| `asr-test.mjs` | 一句话识别 | `SentenceRecognition`，读 mp3 → Base64 → `SourceType=1` |

流式 TTS 的核心难点是**签名**：把所有参数按 key 字典序排序 → RFC 3986 严格 URL 编码 → 拼成 `GETtts.cloud.tencent.com/stream_wsv2?<参数串>` → HMAC-SHA1 → Base64 → 拼进 URL。写完流式脚本后，再把合成出的 `output3.mp3` 喂给 ASR 脚本，实现"合成 → 识别"的保真度闭环验证。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../tts-stt-test/src/tts-test.mjs`](../tts-stt-test/src/tts-test.mjs) | 一句话 TTS |
> | [`../tts-stt-test/src/streaming-tts-test.mjs`](../tts-stt-test/src/streaming-tts-test.mjs) | 流式 TTS + WebSocket 签名 |
> | [`../tts-stt-test/src/asr-test.mjs`](../tts-stt-test/src/asr-test.mjs) | 一句话识别 |

#### 3.2 封装成语音中继服务（asr-and-tts-nest-service）

把上面验证过的能力组合成一条流水线：

```
浏览器录音 ──▶ 腾讯云 ASR（语音 → 文本）
                  │
                  ▼
            LangChain 流式问答（文本流）
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
   SSE 推文字给前端      事件总线 → 腾讯云流式 TTS（文本 → mp3 分片）
        │                    │
        ▼                    ▼
   前端打字机渲染        WebSocket 推 mp3 二进制，边收边播
```

架构上几个设计很值得记：

1. **SSE + WebSocket 双通道分工**：SSE 是纯文本协议，传不了二进制，所以 AI 文字走 SSE、音频分片走自建的 `ws` WebSocket；
2. **事件总线解耦**：`AiModule` 与 `SpeechModule` 互不 import，用 `@nestjs/event-emitter` 的进程内事件通信——`AiService` 每产出 chunk 就 `emit`，`TtsRelayService` 用 `@OnEvent` 订阅。**谁先谁后、谁来订阅都变成可插拔的**；
3. **`ttsSessionId` 关联**：一条 WebSocket 连接 ↔ 一条 SSE 流用会话 id 绑定；
4. **边生成边合成**：chunk 同时发给 SSE 和 TTS，两条流并行；TTS 连接未就绪前 chunk 进 `pendingChunks` 缓存，`ready` 后 flush，避免丢句；
5. 腾讯云流式 TTS 的协议为 `ACTION_SYNTHESIS`（逐段）→ `ACTION_COMPLETE`（结束）。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../asr-and-tts-nest-service/src/ai/ai.service.ts`](../asr-and-tts-nest-service/src/ai/ai.service.ts) | 流式链 + 逐 chunk 发事件 |
> | [`../asr-and-tts-nest-service/src/speech/tts-relay.service.ts`](../asr-and-tts-nest-service/src/speech/tts-relay.service.ts) | 腾讯云流式 TTS 中继（签名/双 WS） |
> | [`../asr-and-tts-nest-service/src/speech/speech.service.ts`](../asr-and-tts-nest-service/src/speech/speech.service.ts) | 腾讯云 ASR |
> | [`../asr-and-tts-nest-service/src/common/stream-events.ts`](../asr-and-tts-nest-service/src/common/stream-events.ts) | 事件名/事件类型定义 |

---

### 四、agui-backend + agui-frontend：消息协议统一的全栈应用

到这一步，后端每个服务的 SSE 格式都"自成一派"：有的推纯文本，有的推 `{data}`，有的要自己拼 prompt 历史。**没有统一的消息协议，前端就没法复用。** `agui` 前后端要解决的就是这件事。

#### 4.1 引入 Vercel AI SDK 的 UIMessage 协议

后端不再自定义消息格式，而是直接遵循 **Vercel AI SDK 的 `UIMessage` 协议**（`{ id, role, parts[] }`），前端用配套的 `useChat` 直接对接：

```jsonc
// 请求体 POST /ai/chat：多轮历史由前端完整带回
{
  "messages": [
    { "id": "1", "role": "user",
      "parts": [{ "type": "text", "text": "搜索一下最近的 AI 新闻并给我发邮件" }] }
  ]
}
```

后端的桥接全部由 `@ai-sdk/langchain` 完成：

```ts
// ai.service.ts —— LangChain Agent → AI SDK 流
const agent = createAgent({ model, tools, systemPrompt });
const stream = await agent.stream(
  { messages: toBaseMessages(messages) },          // UIMessage → LangChain 消息
  { streamMode: ['messages', 'values'], recursionLimit: 30 }
);
return toUIMessageStream(stream);                  // LangChain 流 → AI SDK 流
```

控制器用 `pipeUIMessageStreamToResponse` 直接写 SSE 响应（`@Res()` 自行接管）。模型实例 `CHAT_MODEL`、两个工具 `WEB_SEARCH_TOOL`（博查联网搜索）、`SEND_MAIL_TOOL`（SMTP 发邮件）依旧全部走**工厂注入**。`createAgent` 是 LangChain 高层 API，一行构建带自动工具循环的 Agent，替代了此前手写的 ReAct 循环。

#### 4.2 前端：流式渲染 + 工具调用可视化

前端是 React 19 + Vite + Tailwind：

- `useChat` + `DefaultChatTransport` 一行接上后端 SSE，`messages` / `status` / `stop` 由 hook 托管；
- 渲染时遍历 `message.parts`：`text` 片段交给 **Streamdown** 做"流式 Markdown"（未闭合的 Markdown 也能边写边渲染，代码高亮 + Mermaid 图）；
- 工具调用用卡片可视化：`web_search` 卡片实时展示"参数生成光标动画 → 结构化搜索结果列表"，`send_mail` 卡片展示"收件人/主题/正文逐字生成 → 发送进度 → 结果/错误"。工具 part 的状态机 `input-streaming → input-available → output-available/output-error` 驱动 UI 分阶段渲染。

**这是第二阶段"工程化"的顶点**：前端只认识一个标准协议，后端只提供一套标准接口，中间全靠 AI SDK 对齐——从此加一个新工具 = 后端加一个 tool + 前端加一种卡片，谁都不碰对方的协议。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../agui-backend/src/ai/ai.module.ts`](../agui-backend/src/ai/ai.module.ts) | CHAT_MODEL + 工具工厂注入 |
> | [`../agui-backend/src/ai/ai.service.ts`](../agui-backend/src/ai/ai.service.ts) | createAgent + UIMessage 桥接 |
> | [`../agui-backend/src/ai/ai.controller.ts`](../agui-backend/src/ai/ai.controller.ts) | SSE 输出 |
> | [`../agui-frontend/src/App.tsx`](../agui-frontend/src/App.tsx) | useChat 主聊天界面 |
> | [`../agui-frontend/src/components/ToolPanels.tsx`](../agui-frontend/src/components/ToolPanels.tsx) | 工具调用可视化 |
> | [`../agui-frontend/src/components/StreamdownText.tsx`](../agui-frontend/src/components/StreamdownText.tsx) | 流式 Markdown |

---

## 波次二：图编排 + 检索生产化

`agui-backend` 里用到了 `createAgent`、`streamMode`、`recursionLimit` 这些"封装好了但看不清内部"的机制。下一波次先花一整组项目把这些机制**从黑盒里拆出来**，然后沿"检索"这条线一路升级到生产级。

### 五、langgraph-test：从链到图

#### 5.1 为什么从 LCEL 升级到 LangGraph？

第一阶段用 LCEL 编排 chain，本质上是一条**静态流水线**：A → B → C，分支也只是 if-else。但真实 Agent 需要的是：

- **状态**（跨节点共享和累积，比如 messages 一直在增长）
- **循环**（工具调用没结束就回到模型）
- **条件跳转**（看检索结果决定要不要联网回退）
- **持久化 / 断点续跑 / 人工审批**
- **多个 Agent 相互委派**

这些用"链"表达很别扭，用**图**表达很自然。LangGraph 就是把 LangChain 的组件当成图的**节点**，用**边**描述流转。

#### 5.2 核心心智：状态是"黑板"，节点只写增量

```js
// basic-graph.mjs 核心 —— Annotation 声明状态，reducer 定义合并规则
const GraphState = Annotation.Root({
  messages: Annotation({
    reducer: (left, right) => left.concat(right),   // 追加式合并
    default: () => [],
  }),
});

const chatNode = async (state) => {
  const res = await model.invoke(state.messages);   // 节点读全局状态
  return { messages: [res] };                       // 只返回"增量"
};

const graph = new StateGraph(GraphState)
  .addNode('chat', chatNode)
  .addEdge(START, 'chat')
  .addEdge('chat', END)
  .compile();

await graph.invoke({ messages: [new HumanMessage('你好')] });
```

第一次 `invoke` 的输入就是状态的初始值；每个节点返回的对象会被**框架按 reducer 合并**回全局状态（追加、覆盖、或自定义逻辑），就像大家都在同一块黑板上写字。这就是 LangGraph 与 LCEL 最大的心智差异：**不再是"传参 - 返回"，而是"状态即上下文，节点只改自己想改的字段"。**

#### 5.3 图的能力逐级解锁

这个项目用 13 个最小脚本把 LangGraph 由浅入深过了一遍：

| 脚本 | 学会的能力 |
|------|-----------|
| `conditional-routing.mjs` | `addConditionalEdges` 按状态分流 |
| `loop-retry.mjs` | 条件边"自环"实现失败重试 |
| `checkpointer-memory.mjs` | `MemorySaver`：同 `thread_id` 状态跨轮累加、跨线程隔离 |
| `checkpointer-sqlite.mjs` | `SqliteSaver`：状态落盘，重启可恢复 |
| `graph-interrupt.mjs` | `interrupt()` 暂停图等人审批，`Command.resume` 续跑 |
| `prebuilt-agent.mjs` | `createAgent` 一行组出带工具循环的 Agent |
| `prebuilt-tool-node.mjs` | 手写复现：`agent 节点 → toolsCondition 判断 → ToolNode 自动执行 → 回 agent` |

工具循环的两条路线值得对比——**封装**和**手写**用的是同一套机制：

```js
// 手写 Agent 工具循环：条件边 + 预置 ToolNode
.addNode('agent', agentNode)
.addConditionalEdges('agent', toolsCondition, { tools: 'tools', end: END })
.addNode('tools', new ToolNode(tools))   // 自动执行 tool_calls 并回填 ToolMessage
.addEdge('tools', 'agent')               // 回到模型继续
```

#### 5.4 多智能体编排：一条演化链

项目最后四个脚本完整记录了"多智能体编排方案"的演化（这也是开发中踩坑最狠的一段）：

1. **库级封装** `createSupervisor`：主管模型每轮派一个子代理。看似开箱即用；
2. **踩坑**：DeepSeek 等 OpenAI 兼容模型会忽略 `parallel_tool_calls: false`，一次返回多个 handoff，而 LangGraph 只处理第一个 → 消息丢失 → 400 报错。解法是用 `postModelHook` 在**机制层**强制只保留第一个 tool_call；
3. **手写路由** `withStructuredOutput`：让模型输出 `{ next: 'weather_agent' | 'trivia_agent' | 'FINISH' }`，天然一次只选一个，对 DeepSeek/千问/OpenAI 全兼容；配 `usedAgents` 去重 + 兜底强制 FINISH 防超递归；
4. **并行扇出 `Send` API**：dispatcher 拆出多个子任务，条件边 `return tasks.map(t => new Send(t.agent, { task }))` 一次并行执行，`results` 用追加式 reducer 汇总到 aggregator——**彻底与模型是否遵守 `parallel_tool_calls` 无关**。

> 一句话：编排方案从"依赖库封装" → "依赖模型行为" → "结构上天然保证"，一步步去掉不确定因素。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../langgraph-test/src/basic-graph.mjs`](../langgraph-test/src/basic-graph.mjs) | 最小 StateGraph |
> | [`../langgraph-test/src/conditional-routing.mjs`](../langgraph-test/src/conditional-routing.mjs) | 条件路由 |
> | [`../langgraph-test/src/checkpointer-sqlite.mjs`](../langgraph-test/src/checkpointer-sqlite.mjs) | 状态落盘 |
> | [`../langgraph-test/src/graph-interrupt.mjs`](../langgraph-test/src/graph-interrupt.mjs) | 人工审批中断 |
> | [`../langgraph-test/src/prebuilt-tool-node.mjs`](../langgraph-test/src/prebuilt-tool-node.mjs) | ToolNode 手写复现 |
> | [`../langgraph-test/src/multi-agent-supervisor.mjs`](../langgraph-test/src/multi-agent-supervisor.mjs) | supervisor 方案 |
> | [`../langgraph-test/src/multi-agent-supervisor-posthook.mjs`](../langgraph-test/src/multi-agent-supervisor-posthook.mjs) | postModelHook 截断 |
> | [`../langgraph-test/src/multi-agent-serial-router.mjs`](../langgraph-test/src/multi-agent-serial-router.mjs) | 结构化路由 |
> | [`../langgraph-test/src/multi-agent-parallel-router.mjs`](../langgraph-test/src/multi-agent-parallel-router.mjs) | Send 并行扇出 |

---

### 六、advanced-rag：RAG 的高级形态

有了 LangGraph，RAG 就不再是"一条直线的 retrieve → generate"，而可以带**判断、循环、回退**。这个项目用《天龙八部》向量数据（来自 `milvus-test` 的入库），写了四个逐级变聪明的示例。

| 示例 | 痛点 | 图结构 |
|------|------|--------|
| `naive-rag.mjs` | 基线：所有问题都检索 | `retrieve → generate` |
| `rag-query-router.mjs` | 简单问题不必浪费算力 | 模型先判断 `direct`（直接答）还是 `retrieve`（检索） |
| `rag-multihop.mjs` | 复合问题一次检索答不全 | `route → decompose 拆子问题 → retrieve → plan 判断够了没 → 不够循环回去` |
| `rag-webfallback.mjs` | 本地库查不到 | `retrieve_local → evaluate 评估 → 不足则 web_search（博查）→ 二次评估 → generate 综合` |

几个贯穿全项目的实战经验：

1. **路由/评估/规划都依赖 `withStructuredOutput`**，比如路由输出 `{ type: 'direct' | 'retrieve' }`、多跳规划输出 `{ done, next_questions }`；
2. **防死循环兜底**：多跳用 `hop_count + MAX_HOPS=4` 硬上限，联网回退设计成"只回退一次"（`evaluate_web` 不再回退）；
3. **去重**：`mergeUnique` 按文档 content 去重，多轮检索片段在同一个 state 里累积；
4. **状态白名单制的坑**：节点返回**未在 `GraphState` 声明的字段会被静默丢弃**——`rag-webfallback` 里漏声明 `sufficient / search_queries` 导致的 `searchQueries is not iterable` 报错，就是排查这种问题留下的记录。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../advanced-rag/src/naive-rag.mjs`](../advanced-rag/src/naive-rag.mjs) | 朴素 RAG（对照基线） |
> | [`../advanced-rag/src/rag-query-router.mjs`](../advanced-rag/src/rag-query-router.mjs) | 查询路由 |
> | [`../advanced-rag/src/rag-multihop.mjs`](../advanced-rag/src/rag-multihop.mjs) | 多跳 / Plan-and-Execute |
> | [`../advanced-rag/src/rag-webfallback.mjs`](../advanced-rag/src/rag-webfallback.mjs) | 本地不足 → 联网回退 |

---

### 七、es-test：Elasticsearch + Milvus 混合检索

RAG 场景到了中文内容就绕不开**分词**问题，也绕不开"单库召回不够准"。这个项目补上了 **Elasticsearch（全文检索）与 Milvus（向量检索）的混合检索**，并引入 **Rerank 重排**。

#### 7.1 ES 基础设施

- docker-compose 起 ES 8 + Kibana + Milvus 全家桶；ES 在 Windows 上 9200 是保留端口，映射宿主 **9300**；
- ES 装 **IK 中文分词**插件，核心心法：索引用 `ik_max_word`（切到最细、召回全），搜索用 `ik_smart`（切得准、语义好），mapping 里 `analyzer` 与 `search_analyzer` 分别配置。

#### 7.2 混合检索全链路（LangGraph 六节点）

```
START → query_augment（LLM 把问题扩展成 3 条问句）
         ├─ es_recall（multi_match，标题字段权重 ×2）       ← 并行
         └─ milvus_recall（向量相似度）                     ←
                 ↓
             merge（按业务 id 去重，ES 结果在前）
                 ↓
             rerank（DashScope 重排，top_n=3）
                 ↓
             generate_answer → END
```

- **双路并行**：`addEdge("query_augment", "es_recall")` + `addEdge("query_augment", "milvus_recall")` 让两条边自动并行，`addEdge(["es_recall", "milvus_recall"], "merge")` 表示双路都完成才汇合；
- **查询扩展**：模型把原问题改写成 3 个角度不同的问句（有去空/补位/截断兜底），扩大召回覆盖面；
- **预算均分**：两库的 top-k 按问句数量均分（如各 15 → 3 句每库 5 条），控制进入重排的文档量；
- **跨库去重**：两条路的文档都带业务 id，`dedupeDocsById` 只按 id 去重（ES 在前优先保留）；
- **自定义 Rerank**：继承 `BaseDocumentCompressor` 实现 `compressDocuments`，调用 DashScope 文本排序接口，就能无缝接进 LangChain 的 `ContextualCompressionRetriever`；
- **种子数据双写**：同一批数据同时进 ES（`_id` = 业务 id）和 Milvus（`HNSW + L2`）。注释里有一段精辟论证：`text-embedding-v3` 是归一化向量，**L2 距离平方 = 2 − 2·cosθ，L2 排序 ≡ 余弦排序**——所以模型用 L2 度量完全等价于余弦，数值还更稳。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../es-test/src/rag/hybrid-retrieval.mjs`](../es-test/src/rag/hybrid-retrieval.mjs) | 混合检索 LangGraph 全链路 |
> | [`../es-test/src/rag/query-augment.mjs`](../es-test/src/rag/query-augment.mjs) | 查询扩展 |
> | [`../es-test/src/rerank/dashscope-rerank.mjs`](../es-test/src/rerank/dashscope-rerank.mjs) | 自定义 Rerank（BaseDocumentCompressor） |
> | [`../es-test/src/rag/seed-data.mjs`](../es-test/src/rag/seed-data.mjs) | ES + Milvus 双写种子数据 |
> | [`../es-test/src/create.mjs`](../es-test/src/create.mjs) | ES 建索引 |
> | [`../es-test/src/operate.mjs`](../es-test/src/operate.mjs) | ES 文档 CRUD 与全文检索 |

---

### 八、neo4j-graphrag：Text2Cypher 图谱检索

向量 RAG 擅长"语义相似"，但遇到**关系明确、需要精确多跳**的问题（"珍珠奶茶有哪些配料""台式奶茶属于什么类型"）就会把相似但不相关的内容混进来。这个项目换一条路线：**把知识放进 Neo4j 知识图谱，让大模型把问题翻译成 Cypher 查询，精确检索事实**。

图谱结构（奶茶主题）：

```
(Product: 奶茶) -[:属于]-> (Type: 类型)
(Product)      -[:包含]-> (Ingredient: 配料)
(Product)      -[:适合]-> (People: 人群)
(Ingredient)   -[:使用]-> (Method: 工艺)
```

GraphRAG 工作流是 LangGraph 三个线性节点：

```
generateCypher（LLM 写 Cypher）
   → executeGraph（graph.query 执行，结果进 context）
   → generateAnswer（基于查询结果回答）
```

几个关键设计：

- **把图谱 Schema 直接写进 Cypher 生成 prompt**（节点标签、关系方向、生成规则），显著降低"方向写反、多跳连错"的概率；
- **坏 Cypher 不中断流程**：执行异常兜底为"未查询到相关知识"，让生成节点体面收场；
- **不编造**：生成 prompt 要求不推断图谱外配料，且 `temperature=0`；
- 附两份 Cypher 笔记（`cypher.md` / `cypher2.md`）记录了建节点、建关系、多跳查询、改属性、删关系的完整练习；
- `neo4j-test.mjs` 用原生 `neo4j-driver` 直连做底层增删改查，与 LangChain 封装相互对照。

> 至此"检索"形成三条互补路线：**向量语义召回（Milvus）→ 全文+向量混合（ES）→ 图谱精确查询（Neo4j）**。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../neo4j-graphrag/src/graphrag.mjs`](../neo4j-graphrag/src/graphrag.mjs) | GraphRAG 工作流 |
> | [`../neo4j-graphrag/src/neo4j-test.mjs`](../neo4j-graphrag/src/neo4j-test.mjs) | neo4j-driver 底层操作 |
> | [`../neo4j-graphrag/cypher.md`](../neo4j-graphrag/cypher.md) | Cypher 学习笔记 |

---

### 九、langsmith-test：给 Agent 装上"质检仪"

RAG 做得再花哨，没有评测就不知道答案是不是在**忠实于检索结果**。这个项目引入 **LangSmith** 的可观测性与评测体系，把前面所有链路的"黑盒执行"变成"可审计、可量化"。

#### 9.1 RAG 应用搭建（被测对象）

- `milvus_insert.mjs`：读客服文档 → `RecursiveCharacterTextSplitter`（500/50）切块 → `text-embedding-v3` 向量化 → 原生 SDK 建集合插入 Milvus（字段名对齐 LangChain 约定）；
- `rag_agent.mjs`：LangGraph 状态图 `START → retrieve → generate → END`，generate 用系统提示词硬约束"仅依据上下文回答，不知道就明说"防幻觉；
- `cli.mjs`：命令行问答入口，可查看命中的引用片段。

#### 9.2 LLM-as-Judge 评测

```js
// eval/evaluators.mjs —— 三个 RAG 评测器
const groundedness = createLLMAsJudge({
  prompt: RAG_GROUNDEDNESS_PROMPT,     // 忠实度：答案是否忠于检索片段
  judge, feedbackKey: 'rag_groundedness', continuous: true,   // 0~1 连续分
});
```

| 指标 | 考察点 | 防的是什么 |
|------|--------|-----------|
| `rag_groundedness` | 答案与检索片段的忠实度 | 幻觉 |
| `rag_helpfulness` | 答案是否解决了问题 | 答非所问 |
| `rag_retrieval_relevance` | 检索片段与问题的相关性 | 召回不相关 |

- `build_dataset.mjs` 构建评测数据集 `rag-eval-v1`（12 条问答对），已有则复用；
- `run_eval.mjs` 跑 `evaluate(...)`：被测函数返回 `{ answer, context }` 作为评测器输入契约，每次运行生成一个 **experiment**，方便以后横向对比不同模型/参数；
- 评测过程完整上报 LangSmith，可在 smith.langchain.com 上查看 trace 与分数。

> 评测闭环的意义：**以后改 chunk 大小、换 embedding 模型、调 prompt，都能用同一套数据跑出可对比的分数，而不是靠感觉**。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../langsmith-test/src/rag_agent.mjs`](../langsmith-test/src/rag_agent.mjs) | RAG Agent |
> | [`../langsmith-test/src/milvus_insert.mjs`](../langsmith-test/src/milvus_insert.mjs) | 数据入库 |
> | [`../langsmith-test/src/eval/build_dataset.mjs`](../langsmith-test/src/eval/build_dataset.mjs) | 构建评测数据集 |
> | [`../langsmith-test/src/eval/evaluators.mjs`](../langsmith-test/src/eval/evaluators.mjs) | OpenEvals 评测器 |
> | [`../langsmith-test/src/eval/run_eval.mjs`](../langsmith-test/src/eval/run_eval.mjs) | 跑评测并上报 LangSmith |

---

## 波次三：Agent 框架深水区 + 记忆体系

### 十、deepagents-test：Agent 也是"可插拔"的

`createAgent` 之后，LangChain 又往前走了一步：把 Agent 的各种增强能力（文件系统、记忆、技能、子 Agent、长会话摘要）全部做成**中间件**。这个项目先从零手写中间件理解机制，再逐个拆解 deepagents 官方五大中间件。

#### 10.1 手写中间件：钩子机制

`createMiddleware` 提供了几个挂载点（`middleware-test.mjs` / `middleware-test2.mjs`）：

| 钩子 | 作用 |
|------|------|
| `beforeAgent / afterAgent` | Agent 生命周期起止 |
| `beforeModel / afterModel` | 每次模型调用前后（可统计调用次数） |
| `wrapModelCall(request, handler)` | 完全包裹一次模型调用，可改写请求（如注入 system 约束）再放行 |
| `canJumpTo('end')` | 命中条件直接跳过模型调用结束（如命中敏感词） |
| `tools: [...]` | 中间件**额外给 Agent 注册工具** |
| `wrapToolCall` | 工具执行前后拦截，可改写工具结果、`Command.update` 写回状态 |
| `stateSchema` | 声明中间件可读写状态字段（如 `modelCallCount`） |

这套机制的思想是：**最小 Agent = `createAgent({ model, tools, systemPrompt })`，其余一切能力都是插在它身上的中间件**，自由组合、可插拔。

#### 10.2 deepagents 官方五大中间件 demo

| Demo | 中间件能力 | 设计亮点 |
|------|-----------|----------|
| `filesystem-agent.mjs` | 虚拟文件系统 + 权限 | `FilesystemBackend({ virtualMode: true })` 把真实目录映射成虚拟根；`permissions` 声明式规则"先匹配先生效、未命中默认放行"，越权以 `permission denied` 反馈而非抛错 |
| `memory-agent.mjs` | 项目/用户两级记忆 | 项目级 `AGENTS.md` + 用户级 `preferences.md`，每轮作为 `<agent_memory>` 注入；写入靠模型主动 `edit_file` 落盘 |
| `skills-agent.mjs` | 按需加载技能 | 技能目录暴露给模型，模型按需 `read_file` 对应 `SKILL.md` 拿到"操作手册" |
| `subagent-agent.mjs` | 子 Agent 委派 | 主 Agent 获得 `task` 工具，按 `description` 挑选子 Agent 委派，自己只编排不干活 |
| `summarization-agent.mjs` | 长会话滚动摘要 | 消息到阈值触发摘要并落盘，上下文裁剪保留最近几条——解决"聊太多撑爆上下文" |

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../deepagents-test/src/middleware-test.mjs`](../deepagents-test/src/middleware-test.mjs) | 手写中间件（日志/注入/短路） |
> | [`../deepagents-test/src/middleware-test2.mjs`](../deepagents-test/src/middleware-test2.mjs) | 中间件注册工具 + wrapToolCall |
> | [`../deepagents-test/src/deepagents/filesystem-agent.mjs`](../deepagents-test/src/deepagents/filesystem-agent.mjs) | Filesystem 中间件 |
> | [`../deepagents-test/src/deepagents/memory-agent.mjs`](../deepagents-test/src/deepagents/memory-agent.mjs) | Memory 中间件 |
> | [`../deepagents-test/src/deepagents/summarization-agent.mjs`](../deepagents-test/src/deepagents/summarization-agent.mjs) | Summarization 中间件 |

---

### 十一、deep-research-assistant：深度调研助手

前面所有能力（虚拟文件系统、技能、记忆、子 Agent、代码执行、流式）在这个实战项目里被 `createDeepAgent` 一次组装成一个**深度调研工作流**：主 Agent 规划任务、并行委派调研员、用代码解释器做数据分析、最后产出报告文件。

#### 11.1 Agent 组装

```js
// agent.mjs —— createDeepAgent：一次开启文件系统 + 记忆 + 技能 + 子 Agent
const agent = createDeepAgent({
  model,
  systemPrompt: orchestratorPrompt,   // 编排提示词：规划 → 委派 → 撰写 → 审稿
  backend: new FilesystemBackend({ rootDir, virtualMode: true }),
  memory: ['AGENTS.md'],               // 长期记忆（中文报告偏好等）
  skills: ['skills/'],                 // web-research / report-writer 两个技能
  subagents: { researcher, analyst, editor },   // 3 个专职子 Agent
});
```

三个子 Agent 各司其职：

| 子 Agent | 工具 | 纪律 |
|----------|------|------|
| researcher 调研员 | 只有 `webSearch` | ≤3 次搜索，写 findings 后立刻停止 |
| analyst 数据分析师 | `createCodeInterpreterMiddleware()`（QuickJS eval REPL） | 数值算给机器，禁止凭空猜 |
| editor 审稿编辑 | 无工具 | 只审阅不改稿 |

还有一个关键细节：deepagents 默认会为每个 Agent 注册一个通用的 `general-purpose` 兜底子 Agent，会破坏流程纪律，所以用 `registerHarnessProfile(..., { generalPurposeSubagent: { enabled: false } })` **显式关闭**。

#### 11.2 调研流程

```
① 规划：write_todos 拆任务
② 按 web-research 技能写 research_plan.md，并行委派 researcher（≤3 个）
③ 需要数值 → 委派 analyst（eval REPL 计算）
④ 主 Agent 按 report-writer 技能起草 draft_*.md
⑤ 委派 editor 审稿（只反馈）
⑥ 修订定稿 report_<主题>_<日期>.md
```

CLI 用 `agent.stream(..., { streamMode: 'updates', subgraphs: true })` 实时打印每个子 Agent 的步骤日志；工具对 API 的一切失败都返回**中文错误串而非抛异常**，让模型自己改关键词重试。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../deep-research-assistant/src/agent.mjs`](../deep-research-assistant/src/agent.mjs) | createDeepAgent 组装 |
> | [`../deep-research-assistant/src/cli.mjs`](../deep-research-assistant/src/cli.mjs) | 流式 CLI |
> | [`../deep-research-assistant/src/tools/search.mjs`](../deep-research-assistant/src/tools/search.mjs) | 联网搜索工具 |
> | [`../deep-research-assistant/skills/`](../deep-research-assistant/skills/) | web-research / report-writer 技能 |

---

### 十二、记忆与存储体系：Redis / pgvector / Mem0

第二阶段最后补的是"记忆到底该存在哪"这个问题。第一阶段的 `memory-test` 只有文件/内存级演示，这里升级到**真实存储设施**：Redis（短期）、PostgreSQL + pgvector（长期 + 向量检索）、Mem0（专业记忆平台）。

#### 12.1 redis-test：Redis 基础 + Agent 短期记忆

**基础部分**：ioredis 实操五大类型——String（验证码/TTL）、Hash（对象）、List（队列/历史）、Set（去重/标签）、ZSet（排行榜），外加**分布式锁标准写法** `set(key, 'locked', 'NX', 'EX', 10)`（NX 保证互斥、EX 防止死锁）。

**Agent 短期记忆落地**是重点，核心是三层设计：

1. **Key 设计**：`agent:short_memory:<sessionId>:messages`，换 sessionId 天然多用户隔离；
2. **TTL 自动遗忘**：每次写回 `EX 1800`（30 分钟），没聊就过期，无需手动清理；
3. **序列化协议**：ChatMessage 类实例不能直接 `JSON.stringify` 落库，必须用 `mapChatMessagesToStoredMessages` 摊平成纯 JSON 的 `StoredMessage`，读回用 `mapStoredMessagesToChatMessages` 重建类型化实例——**存的是跨进程/跨语言可读的可移植结构**；
4. **摘要压缩**：消息到 8 条时 `summarizationMiddleware` 自动压缩、保留最近 4 条 + 摘要（`lc_source="summarization"` 标记的 HumanMessage 继续参与对话）；`DEBUG_SUMMARIZE=1` 可打印被压缩的消息与摘要原文。

```js
// agent-with-redis-memory.mjs 读写闭环
const messages = await store.loadMessages(sessionId);   // invoke 前读历史
const res = await agent.invoke({ messages });
await store.saveMessages(sessionId, [...messages, ...res.messages]);  // invoke 后写回
```

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../redis-test/src/redis-test.mjs`](../redis-test/src/redis-test.mjs) | 五大类型 + 分布式锁 |
> | [`../redis-test/src/agent-with-redis-memory.mjs`](../redis-test/src/agent-with-redis-memory.mjs) | Agent 短期记忆 |

#### 12.2 pgsql-test：pgvector 让关系库"长出"向量检索

模型：**用户 → 会话 → 消息**三级结构（外键 `ON DELETE CASCADE`），消息表带 `embedding vector(1024)` 列，pgvector 扩展让 PostgreSQL 同时承担业务存储与语义检索。

- `db.mjs` 用 pg `Pool`，SQL 全部 `$1/$2` 参数化防注入；
- 语义检索核心：

```sql
SELECT id, content,
       1 - (embedding <=> $1::vector) AS similarity   -- 余弦距离换算成相似度
FROM messages
WHERE conversation_id = $2 AND embedding IS NOT NULL
ORDER BY embedding <=> $1::vector                     -- 按余弦距离升序
LIMIT $3;
```

- 建 **HNSW 索引**（`vector_cosine_ops` opclass）加速余弦检索；
- 更新消息时同步重算 embedding，保证检索内容最新；
- 演示了"字面不同也能命中"：查"向量相似度怎么查"能命中含 `<=>` 运算符讲解的消息。

> 对比视角：**RAG 底座现在有三条路线**——独立向量库（Milvus）、全文+向量混合（ES）、关系库内嵌向量（pgvector）。各有适用场景。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../pgsql-test/src/db.mjs`](../pgsql-test/src/db.mjs) | pg 连接池封装 |
> | [`../pgsql-test/src/messages.mjs`](../pgsql-test/src/messages.mjs) | 向量写入 + 语义检索 |
> | [`../pgsql-test/src/index.mjs`](../pgsql-test/src/index.mjs) | 端到端演示入口 |
> | [`../pgsql-test/init-scripts/create_tables.sql`](../pgsql-test/init-scripts/create_tables.sql) | 建表 + pgvector 扩展 |

#### 12.3 mem0-test：专业的记忆平台

前两个项目是"自己造记忆轮子"，Mem0 则是**把记忆做成一个平台**：给 LLM 应用加记忆只需调 API，抽取事实、去重、更新由服务端完成。

**① 云端 MemoryClient 基础操作**：`add(对话)` 服务端异步抽取事实、`search` 语义搜索、`getAll/get/update/history/deleteAll` 齐全：

```js
const memoryClient = new MemoryClient({ apiKey });
await memoryClient.add(messages, { user_id: 'u1' });
const { results } = await memoryClient.search('他住哪里？', {
  filters: { user_id: 'u1' }, topK: 5,
});
// results[0].memory  => "用户住在杭州"
```

**② 三种记忆 scope 的隔离**：

| scope | 生命周期 | 典型内容 |
|-------|----------|----------|
| `user_id` | 跨会话永久 | 用户身份、偏好 |
| `run_id` | 单次会话/任务 | 本次聊天的进度、待办 |
| `agent_id` | Agent 自身 | 角色设定、回答风格 |

**③ 本地部署**：云端 SDK 换成本地 docker 的 mem0 服务后是 OpenAPI 风格（`POST /memories`、`POST /search`），需要自写 `LocalMem0Client`（fetch + X-API-Key）。

**④ 分层记忆 Agent**（`mem0-redis-mem0-agent.mjs`，全程最复杂的示例）把三种记忆叠在一起：

```
Redis      短期：最近几轮消息原文，TTL 30 分钟自动过期
Mem0 user  长期：跨会话事实（姓名/偏好/禁忌）
Mem0 session：本会话任务/进度/待办
```

每轮对话流水：Redis 读历史 → **并行检索 Mem0 两层**并拼成一条 SystemMessage 注入 → Agent 回答（超 8 条自动摘要压缩）→ 写回 Redis（剔除注入的 SystemMessage 防止重复堆叠）→ 用**记忆分类器**（`withStructuredOutput(memorySchema)`）判断本轮有没有新事实、该写 user 层还是 session 层。

> 至此，"记忆"这个词在不同层有不同的落点——下面小节统一收拢。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`../mem0-test/src/mem0-test.mjs`](../mem0-test/src/mem0-test.mjs) | 云端 API 基础操作 |
> | [`../mem0-test/src/mem0-scoped-memory-test.mjs`](../mem0-test/src/mem0-scoped-memory-test.mjs) | 三种 scope 隔离 |
> | [`../mem0-test/src/mem0-local-api-demo.mjs`](../mem0-test/src/mem0-local-api-demo.mjs) | 本地 OpenAPI 直连 |
> | [`../mem0-test/src/mem0-redis-mem0-agent.mjs`](../mem0-test/src/mem0-redis-mem0-agent.mjs) | 分层记忆 Agent |

---

## 十三、总结

### 7.1 第二阶段究竟升级了什么？

对照第一阶段的成果（LangChain 组件 + LCEL），第二阶段的升级可以归成四条主线：

| 主线 | 第一阶段（Demo） | 第二阶段（生产化） | 代表项目 |
|------|-----------------|-------------------|----------|
| 工程形态 | `.mjs` 脚本、无接口 | NestJS Web 服务、SSE 流式、DI 注入、Swagger | hello-nest-langchain / cron-job-tool / asr-and-tts / agui |
| 编排范式 | LCEL 静态链 | LangGraph 状态图、条件路由、checkpointer、多智能体 | langgraph-test / advanced-rag |
| 检索与评测 | 单库向量召回 | 查询路由/多跳/联网回退 → 混合检索+Rerank → GraphRAG → LLM-as-Judge 评测 | advanced-rag / es-test / neo4j-graphrag / langsmith-test |
| 记忆与存储 | 内存/文件 | Redis 短期 + pgvector/向量库 + Mem0 长期 + AGENTS.md 项目记忆 | redis-test / pgsql-test / mem0-test / deepagents-test |

### 7.2 编排层的完整认识链

把第一、二阶段连起来看，Agent 编排是一条逐渐"去硬编码"的路径：

```
手写 ReAct 循环（tool-test / cron-job-tool）
   → LCEL 链（runnable-test）
   → LangGraph 图 + 状态（langgraph-test / advanced-rag）
   → createAgent 高层封装（agui-backend）
   → createMiddleware 中间件体系（deepagents-test）
   → createDeepAgent 全家桶组装（deep-research-assistant）
```

每一层都站在上一层肩膀上，把"循环、状态、分支、回退、多智能体协作"这些样板逻辑沉淀为框架能力。

### 7.3 检索层的完整认识链

```
基础 RAG（rag-test，一条直线）
   → Milvus 向量库（milvus-test）
   → 高级 RAG：路由 / 多跳 / 联网回退（advanced-rag）
   → 全文+向量混合检索 + Rerank（es-test）
   → 知识图谱 Text2Cypher（neo4j-graphrag）
   → LLM-as-Judge 评测闭环（langsmith-test）
```

### 7.4 记忆层的完整认识链

```
第一阶段：截断/总结/检索三策略（memory-test，纯代码演示）
   ↓ 第二阶段
短期记忆   Redis + TTL + StoredMessage 序列化（redis-test）
长期事实    Mem0 user_id 层 / AGENTS.md（mem0-test / deepagents）
任务记忆    Mem0 run_id（session）层
状态记忆    LangGraph checkpointer（SqliteSaver 落盘）
知识记忆    Milvus / ES / pgvector（向量检索）
```

### 7.5 一句话收尾

第一阶段学会的是"**用 LangChain 把大模型变成工业流水线**"；第二阶段学会的是"**把这条流水线装进真实系统，并让它能上图、能检索、能被评测、有记忆、会说话、能定时干活**"。到 `deep-research-assistant` 为止，仓库里已经有一个能联网自主完成"规划—调研—分析—成稿"全流程的 Agent——**从第一阶段的"让模型会调工具"，走到了第二阶段的"让 Agent 独立交付一份工作"**。
