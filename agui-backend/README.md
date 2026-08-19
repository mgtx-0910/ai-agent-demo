# AGUI Backend

一个基于 **NestJS + LangChain + Vercel AI SDK** 的 AI 对话 Agent 后端服务，前端通过一个 SSE 接口即可获得「**流式文字 + 工具调用**」的完整对话能力：

- **流式对话**：`POST /ai/chat` 走 SSE 逐 token 返回，消息格式遵循 Vercel AI SDK 的 `UIMessage` 协议，前端 `useChat` 可直接对接
- **工具型 Agent**：基于 LangChain `createAgent` 构建，模型可自主决定调用两个内置工具——`web_search`（Bocha 联网搜索）与 `send_mail`（SMTP 发送邮件）
- **协议解耦**：`UIMessage ↔ LangChain 消息` 双向转换由 `@ai-sdk/langchain` 完成，AI 前端生态与 LangChain 工具生态无缝衔接

> 典型场景：网页端 AI 助手（配套前端 `agui-frontend`）。用户提问 → 模型流式作答；涉及最新信息时自动联网搜索，需要发邮件时自动调用 SMTP 发送。

---

## 整体流程图

```
┌──────────────┐   POST /ai/chat        ┌──────────────────────────┐
│  前端 / 测试  │ ─────────────────────▶ │  AiController             │
│ (curl / 前端) │   { messages:          │  · 校验 messages 参数     │
│              │     UIMessage[] }      │  · 调用 AiService.stream  │
└──────────────┘                        └────────────┬─────────────┘
                                                     ▼
                                      ┌──────────────────────────────┐
                                      │  AiService（核心）            │
                                      │ ① UIMessage[] → BaseMessage  │
                                      │ ② agent.stream({ messages }, │
                                      │    streamMode:[messages,     │
                                      │    values], recursionLimit:30│
                                      │ ③ LangChain 流 → UIMessage  │
                                      └────────────┬─────────────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    ▼                              ▼                              ▼
          ┌──────────────────┐            ┌──────────────────┐           ┌──────────────────┐
          │ CHAT_MODEL       │            │ WEB_SEARCH_TOOL  │           │ SEND_MAIL_TOOL   │
          │ ChatOpenAI       │◀──调用──── │ Bocha Web Search │           │ MailerService    │
          │ (OpenAI 兼容端点) │            │ (BOCHA_API_KEY)  │           │ (SMTP .env 配置) │
          └──────────────────┘            └──────────────────┘           └──────────────────┘
                                                   │                              │
                                                   ▼                              ▼
                                        api.bochaai.com/v1/web-search    nodemailer 发送邮件
                                                   │
                                                   ▼
                                          格式化搜索结果（带编号引用）
                                                   │
                                                   ▼
                                ToolMessage 回填模型 → 模型基于结果继续生成
                                                   │
                                                   ▼
                         SSE 流逐 token 返回 ────────▶ 前端逐字显示
```

模型在流式生成过程中**自主决定**是否需要调用工具：

```
用户：「北京今天的天气」
  │
  ▼
ChatOpenAI 判断需要实时信息 → 输出 tool_call: web_search(query="北京今天天气")
  │
  ▼
WEB_SEARCH_TOOL 执行 → Bocha API → 返回带编号的搜索结果
  │
  ▼
结果以 ToolMessage 回填 → 模型基于结果组织自然语言回答
  │
  ▼
SSE 逐 token 输出 ──▶ 前端显示「北京今天多云，气温 24~31℃……」
```

---

## 目录结构

```
agui-backend/
├── .env.example                 # 环境变量示例（模型 / 搜索 / 邮件）
├── package.json                 # 依赖：NestJS、LangChain、AI SDK、Mailer
├── nest-cli.json                # Nest CLI 配置
├── tsconfig.json                # TypeScript 配置（NodeNext 模块解析）
├── src/
│   ├── main.ts                  # 启动入口：CORS + 监听端口（PORT ?? 3000）
│   ├── app.module.ts            # 根模块：ConfigModule + MailerModule + AiModule
│   ├── app.controller.ts        # 根路由 GET /（健康检查）
│   ├── app.service.ts           # 根服务（默认问候文案）
│   └── ai/                      # AI 对话模块
│       ├── ai.module.ts         #   CHAT_MODEL / WEB_SEARCH_TOOL / SEND_MAIL_TOOL 工厂注入
│       ├── ai.controller.ts     #   POST /ai/chat（SSE 流式对话）
│       └── ai.service.ts        #   createAgent + stream() 核心链路
└── test/
    ├── app.e2e-spec.ts          # E2E 测试
    └── jest-e2e.json            # E2E Jest 配置
```

---

## 快速开始

### 1. 环境要求

- Node.js 18+
- 可访问的 OpenAI 兼容模型端点（示例指向通义千问 DashScope 兼容模式）
- Bocha 联网搜索 API Key（[博查开放平台](https://open.bochaai.com)，用于 `web_search` 工具）
- 一个 SMTP 邮箱（如 QQ 邮箱授权码），用于 `send_mail` 工具

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

| 变量 | 说明 | 示例 |
|---|---|---|
| `OPENAI_API_KEY` | AI 模型 API 密钥 | `sk-xxx` |
| `OPENAI_BASE_URL` | OpenAI 兼容端点地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `MODEL_NAME` | 模型名 | `qwen-plus` |
| `BOCHA_API_KEY` | Bocha 联网搜索 API Key | `sk-xxx` |
| `MAIL_HOST` | SMTP 服务器地址 | `smtp.qq.com` |
| `MAIL_PORT` | SMTP 端口 | `587` |
| `MAIL_SECURE` | 是否使用 SSL/TLS | `false` |
| `MAIL_USER` | SMTP 登录账号 | `xxx@xx.com` |
| `MAIL_PASS` | SMTP 授权码 / 密码 | `xxx` |
| `MAIL_FROM` | 默认发件人 | `"No Reply" <xxx@xx.com>` |

### 4. 启动服务

```bash
npm run start:dev    # 开发模式（热重载）
# 或
npm run start        # 普通启动
# 或
npm run start:prod   # 生产模式（需先 npm run build）
```

默认监听 `3000` 端口，可通过环境变量 `PORT` 修改。

### 5. 验证

```bash
curl -N -sS -X POST 'http://localhost:3000/ai/chat' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"北京今天的天气"}]}]}'
```

- 浏览器打开 http://localhost:3000/ ，应返回 `Hello World!`
- 上面的 curl 应收到 SSE 流式响应；提问实时性问题可触发 `web_search` 工具

---

## 接口说明

### 1. AI 流式对话（SSE）

```
POST /ai/chat
Content-Type: application/json
```

请求体遵循 Vercel AI SDK 的 **`UIMessage[]`** 协议（`id` + `role` + `parts`，`parts` 支持文本/图片等分片类型）：

```json
{
  "messages": [
    { "id": "1", "role": "user", "parts": [{ "type": "text", "text": "北京今天的天气" }] },
    { "id": "2", "role": "assistant", "parts": [{ "type": "text", "text": "好的，我来查一下。" }] },
    { "id": "3", "role": "user", "parts": [{ "type": "text", "text": "那上海呢？" }] }
  ]
}
```

- 入参校验：`messages` 必须是非空数组，否则返回 `400 Invalid JSON`
- 出参为 SSE 流：服务端通过 `pipeUIMessageStreamToResponse` 将 AI SDK 流式数据直接写入响应，浏览器用 `useChat` / `EventSource` 即可消费
- **多轮上下文**：把历史消息（含助手回复）一并放入 `messages` 即可，无需额外状态管理

### 2. 健康检查

```
GET /
```

返回 `Hello World!`，用于确认服务存活。

---

## 完整流程详解

**Step 1 — 参数校验**

`AiController.postChat` 校验 `body.messages` 是否为非空数组，非法直接抛 `BadRequestException`。

**Step 2 — 协议转换（UIMessage → LangChain）**

`AiService.stream` 先调用 `toBaseMessages(messages)`，把 AI SDK 的 `UIMessage[]` 转成 LangChain 的 `BaseMessage[]`（`HumanMessage` / `AIMessage` / `SystemMessage` / `ToolMessage`）。

**Step 3 — 驱动 Agent 流式执行**

```38:49:src/ai/ai.service.ts
async stream(messages: UIMessage[]) {
  // 1. UIMessage[] → LangChain BaseMessage[]（协议转换）
  const lcMessages = await toBaseMessages(messages);
  // 2. 驱动 agent 流式执行：messages 模式可拿到逐 token 增量，values 模式可拿到完整中间状态
  const lgStream = await this.agent.stream(
    { messages: lcMessages },
    {
      streamMode: ['messages', 'values'], // 同时产出消息增量与 agent 完整状态
      recursionLimit: 30, // 限制工具调用递归深度，防止死循环
    },
  );

  // 3. LangChain 流 → AI SDK UIMessageStream（协议转换回给控制器）
  return toUIMessageStream(lgStream as AsyncIterable<AIMessageChunk>);
}
```

关键点：

- `streamMode: ['messages', 'values']`：同时产出「逐 token 消息增量」与「Agent 完整运行状态」，前端可实时渲染文字并观察工具调用过程
- `recursionLimit: 30`：限制「模型 ↔ 工具」循环调用深度，防止异常场景下无限循环

**Step 4 — Agent 工具调用（核心）**

`AiModule` 通过三个 DI token 装配 Agent 的全部依赖：

| Token | 类型 | 说明 |
|---|---|---|
| `CHAT_MODEL` | `ChatOpenAI` | 模型名 / Key / BaseURL 均来自 `.env`，可指向任意 OpenAI 兼容端点 |
| `WEB_SEARCH_TOOL` | LangChain `tool` | Bocha 联网搜索，`BOCHA_API_KEY` 鉴权，返回带编号的搜索结果列表 |
| `SEND_MAIL_TOOL` | LangChain `tool` | 委托 NestJS `MailerService`（复用全局 SMTP 配置）发送邮件 |

`createAgent` 把它们绑定成一个工具型 Agent，系统提示词约定：

> 你是 AI 助手，需要最新信息、事实核查或联网信息时，请使用 `web_search` 工具搜索后再作答。发送邮件用 `send_mail` 工具。

**web_search（Bocha 联网搜索）**：

- 入参 schema：`query`（必填，搜索关键词）+ `count`（可选 1~20，默认 10 条）
- 执行体：`fetch https://api.bochaai.com/v1/web-search`，`freshness: 'noLimit'`、`summary: true`
- 结果格式化：把 `webPages.value` 逐条格式化为「编号 / 标题 / URL / 摘要 / 网站名称 / 图标 / 发布时间」文本，供模型引用
- 容错：缺 Key、HTTP 非 2xx、业务码非 `200`、解析失败，均以文本形式返回给模型转述，不会中断对话

**send_mail（SMTP 发邮件）**：

- 入参 schema：`to`（校验邮箱格式）、`subject`（主题）、`text` / `html`（正文，可选）
- 执行体：`mailerService.sendMail`，发件人取 `.env` 的 `MAIL_FROM`
- 成功返回 `邮件已发送到 <to>，主题为「<subject>」`，由模型向用户确认

**Step 5 — 结果回填与输出**

工具执行结果作为 `ToolMessage` 回填给模型，模型基于搜索结果 / 发送结果继续组织自然语言回答，最终经 SSE 逐 token 返回前端。

---

## 设计说明

### 为什么引入 Vercel AI SDK（协议层）

`UIMessage` / `UIMessageStream` / `pipeUIMessageStreamToResponse` 是 AI SDK 的标准协议：

- 前端（`agui-frontend`）可直接使用 `useChat` 等工具，**消息格式零适配**
- SSE 的响应格式、流式结束等细节由 SDK 处理，后端只需把 LangChain 流转换过去
- 若未来换用别的大模型生态，协议层保持不变

### 为什么用 LangChain createAgent（工具型 Agent）

- 模型是否联网搜索、是否发邮件，由模型**运行时自主决策**，后端无需硬编码「什么问题走什么工具」
- `createAgent` 封装了「模型 → 工具调用 → 结果回填 → 再生成」的完整循环，配 `recursionLimit` 防失控
- 两个工具都用 LangChain `tool()` 封装，参数 schema（zod）自动注入模型提示，与 LangChain 生态一致

### 为什么 `AiModule` 用工厂函数注入

三个 provider（`CHAT_MODEL` / `WEB_SEARCH_TOOL` / `SEND_MAIL_TOOL`）都依赖运行时配置或外部服务：

- `CHAT_MODEL`：需要 `ConfigService` 读取模型配置，且 `SEND_MAIL_TOOL` 还依赖全局 `MailerModule` 的 `MailerService`——用 `useFactory` + `inject` 显式声明依赖
- 集中在一个模块装配，`AiService` 只声明 `@Inject('TOKEN')`，换实现时改 `AiModule` 一处即可

---

## 测试

```bash
# 单元测试
npm run test

# E2E 测试
npm run test:e2e
```

---

## 常见问题

- **模型从不调用 `web_search`**：确认 `BOCHA_API_KEY` 已配置；实时性问题（天气、新闻、年报等）才触发搜索，通用知识问答模型会直接作答
- **邮件发送失败**：检查 SMTP 五项配置（`MAIL_HOST` / `MAIL_PORT` / `MAIL_SECURE` / `MAIL_USER` / `MAIL_PASS`）；QQ / 163 等邮箱需使用**授权码**而非登录密码，`MAIL_SECURE` 需与端口匹配（465 用 `true`，587 用 `false`）
- **curl 无响应 / SSE 中断**：确认请求 `Content-Type: application/json` 且 `messages` 为数组；模型端点需支持流式（`stream`）
- **AI 无回复**：检查 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `MODEL_NAME`，该服务使用 OpenAI 兼容协议，`BASE_URL` 需指向兼容端点
- **前端跨域异常**：服务已开启 CORS（`origin: '*'` + `credentials: true`）；注意携带凭证时浏览器会忽略通配符，生产环境建议改为具体域名
