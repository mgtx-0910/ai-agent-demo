# ASR & TTS Nest Service

一个基于 **NestJS** 的语音对话中间件服务，打通「**语音识别 → AI 流式对话 → 语音合成**」全链路：

- **ASR**：调用腾讯云「一句话识别」，把用户语音转成文本
- **AI 对话**：通过 LangChain 接入任意 OpenAI 兼容端点，SSE 流式返回回答
- **TTS**：AI 回答文本实时中继给腾讯云「流式合成」，将音频分片实时推回浏览器播放

> 典型场景：网页端语音助手。用户说话 → 识别为文字 → AI 回答 → 边生成边合成语音播放。

---

## 整体流程图

```
┌──────────────┐  ① 录音上传   ┌───────────────────────┐
│   浏览器端    │ ────────────▶ │  POST /speech/asr     │
│  (public/*)  │               │  SpeechService        │ ──▶ 腾讯云一句话识别(ASR)
│              │               └───────────────────────┘     返回识别文本
│              │
│              │  ② 建立 TTS 通道（等待服务端回传 sessionId）
│              │ ────────────▶ WS /speech/tts/ws
│              │ ◀──────────── { type:'session', sessionId }
│              │
│              │  ③ 发起 AI 流式对话（把 sessionId 作为 ttsSessionId 回传）
│              │ ────────────▶ SSE GET /ai/chat/stream?query=..&ttsSessionId=..
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  AiController（SSE）         事件总线(EventEmitter)              │
│   · emit {type:'start'}  ──────────────▶                        │
│   · AiService.streamChain    · emit {type:'chunk', text} ────▶  │
│     LangChain 流式生成       · emit {type:'end'}            ──▶  │
│   · 文本分片同时写回 SSE ────▶ 浏览器显示文字                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────┐
                │ TtsRelayService（TTS 中继）   │
                │  监听 ai.tts.stream 事件      │
                │  · start → 建立腾讯云 wss     │
                │  · chunk → ACTION_SYNTHESIS  │
                │  · end   → ACTION_COMPLETE   │
                └──────────────┬───────────────┘
                               │ 腾讯云 TextToStreamAudioWSv2
                               ▼
                    二进制音频分片（mp3）
                               │
                               ▼
                      WS /speech/tts/ws ──▶ 浏览器 MediaSource 实时播放
```

---

## 目录结构

```
asr-and-tts-nest-service/
├── .env.example                 # 环境变量示例
├── public/                      # 静态页面（ServeStaticModule 托管）
│   ├── asr.html                 #   语音识别单独测试页
│   └── asr-ai-stream.html       #   AI 语音对话完整 Demo
└── src/
    ├── main.ts                  # 启动入口：挂载 /speech/tts/ws WebSocket
    ├── app.module.ts            # 根模块：配置、事件总线、静态资源装配
    ├── app.controller.ts        # 根路由 GET /（健康检查）
    ├── app.service.ts           # 根服务
    ├── common/
    │   └── stream-events.ts     # AI→TTS 事件定义（start/chunk/end/error）
    ├── controller/
    │   └── controller.service.ts# 预留的辅助服务
    ├── ai/                      # AI 对话模块
    │   ├── ai.module.ts         #   CHAT_MODEL 工厂注入（ChatOpenAI）
    │   ├── ai.controller.ts     #   SSE 接口 GET /ai/chat/stream
    │   └── ai.service.ts        #   LangChain 流式链 + 事件发布
    └── speech/                  # 语音模块
        ├── speech.module.ts     #   ASR_CLIENT 工厂注入（腾讯云）
        ├── speech.controller.ts #   POST /speech/asr
        ├── speech.service.ts    #   腾讯云一句话识别
        └── tts-relay.service.ts #   TTS 中继：AI文本→腾讯云→浏览器（核心）
```

---

## 快速开始

### 1. 环境要求

- Node.js 18+（建议使用仓库根目录 `.node-version` 指定的版本）
- 腾讯云账号（开通 **语音识别** 与 **语音合成** 服务，获取 `SECRET_ID` / `SECRET_KEY` / `APP_ID`）
- 可访问的 OpenAI 兼容模型端点（或直接使用通义千问 DashScope 等）

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
| `SECRET_ID` | 腾讯云 API 密钥 ID | `xxx` |
| `SECRET_KEY` | 腾讯云 API 密钥 Key | `xxx` |
| `APP_ID` | 腾讯云应用 ID | `1300060157` |
| `TTS_VOICE_TYPE` | 合成音色 ID（默认 `101001` 智瑜） | `502006` |

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

- 浏览器打开 http://localhost:3000/ ，应返回 `Hello World!`
- 打开 http://localhost:3000/asr.html → 测试语音识别
- 打开 http://localhost:3000/asr-ai-stream.html → 体验完整「语音提问 → AI 文字+语音回答」

---

## 接口说明

### 1. 语音识别（ASR）

```
POST /speech/asr
Content-Type: multipart/form-data
```

- 表单字段：`audio`（音频文件，建议 `ogg-opus` 编码，16k 采样，60 秒内）
- 内部调用腾讯云 `SentenceRecognition`（引擎 `16k_zh`，格式 `ogg-opus`）

```json
// 响应
{ "text": "识别出的文本内容" }
```

### 2. AI 流式对话（SSE）

```
GET /ai/chat/stream?query=你好&ttsSessionId=<可选>
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `query` | 是 | 用户问题 |
| `ttsSessionId` | 否 | 携带时触发 TTS 语音合成联动 |

响应为 SSE 流，`data` 字段逐个返回 AI 生成的文本分片；结束时浏览器侧收到 `error` 事件即代表完成。

### 3. TTS 音频订阅（WebSocket）

```
WS /speech/tts/ws?sessionId=<可选>
```

| 查询参数 | 必填 | 说明 |
|---|---|---|
| `sessionId` | 否 | 不传则由服务端生成随机 UUID |

服务端 `main.ts` 在连接建立时把客户端注册到 `TtsRelayService`，并立即回传 `{ type: 'session', sessionId }`；未携带 `sessionId` 时由服务端生成随机 UUID。前端保存该 ID，在发起 AI SSE 请求时作为 `ttsSessionId` 回传，用于将 AI 文本分片路由到本连接（详见「ttsSessionId 获取与回传机制」）。

---

## 完整流程详解

### 场景 A：纯文字对话（无 TTS）

```
浏览器 ──SSE──▶ GET /ai/chat/stream?query=...
                  │
                  ▼
            AiController.chatStream
                  │  未携带 ttsSessionId → 不触发事件
                  ▼
            AiService.streamChain(query)
                  │  PromptTemplate → ChatOpenAI.stream → StringOutputParser
                  ▼
            每个文本分片 yield ──▶ SSE data ──▶ 浏览器逐字显示
```

### 场景 B：语音对话（ASR → AI → TTS 全链路）

前端 `asr-ai-stream.html` 演示了完整链路，关键步骤：

**Step 1 — 录音并识别**

1. `navigator.mediaDevices.getUserMedia` 录音，`MediaRecorder` 以 250ms 切片收集，格式 `audio/ogg;codecs=opus`
2. 录音结束后打包成 Blob，`POST /speech/asr` 上传
3. 服务端 `SpeechController` → `SpeechService.recognizeBySentence` → 腾讯云 `SentenceRecognition`
4. 返回 `{ text }`，识别文本填入输入框

**Step 2 — 建立 TTS 通道（获取 sessionId）**

1. 前端 `ensureTtsConnection()` 打开 `WS /speech/tts/ws`（首次不带 sessionId），挂起等待服务端回传
2. 服务端 `main.ts` 的 `connection` 回调调用 `ttsRelayService.registerClient(socket)` → 未携带则生成随机 UUID，以 JSON 消息 `{ type: 'session', sessionId }` 回传
3. 前端收到 `session` 消息后保存为 `ttsSessionId`，Promise resolve 继续后续流程；同一 WS 连接可复用进行多轮对话

**Step 3 — 发起 AI 流式对话（带 TTS 联动）**

1. 前端用 `EventSource` 请求 `GET /ai/chat/stream?query=<识别文本>&ttsSessionId=<sessionId>`（把 Step 2 拿到的 sessionId 回传）
2. `AiController.chatStream` 先向事件总线 emit `{ type: 'start', sessionId, query }`
3. 随后 `AiService.streamChain` 开始流式生成：
   - 每个文本分片同时执行两件事：
     - `yield chunk` → 经 SSE 推回浏览器显示文字
     - `emit { type: 'chunk', sessionId, chunk }` → 触发 TTS 合成
   - 全部生成完 → `emit { type: 'end', sessionId }`
   - 异常 → `emit { type: 'error', sessionId, error }` 并抛出

**Step 4 — TTS 中继与音频回播**

`TtsRelayService` 监听 `ai.tts.stream` 事件，维护一张 `sessionId → ClientSession` 会话表：

| 事件 | 中继动作 |
|---|---|
| `start` | 惰性建立到腾讯云的 `wss://tts.cloud.tencent.com/stream_wsv2` 连接（带 HMAC-SHA1 签名 URL），同时给浏览器发 `{ type: 'tts_started' }` |
| `chunk` | 腾讯云未就绪前存入 `pendingChunks` 缓存；就绪后发 `{ action: 'ACTION_SYNTHESIS', data: 文本 }` |
| `end` | 先 `flushPendingChunks` 清空缓存，再发 `{ action: 'ACTION_COMPLETE' }` 通知结束 |
| `error` | 给浏览器发 `{ type: 'tts_error', message }` 并关闭会话 |

腾讯云侧的响应处理：

- **二进制消息** = mp3 音频分片 → 直接原样转发给浏览器 WebSocket
- **JSON 消息**：
  - `ready === 1` → 标记就绪，`flushPendingChunks` 补齐此前缓存的文本分片
  - `code !== 0` → 给浏览器发 `tts_error` 并关闭会话
  - `final === 1` → 给浏览器发 `{ type: 'tts_final' }`（合成结束）

浏览器端收到二进制分片后，通过 **MediaSource + SourceBuffer**（`audio/mpeg`，sequence 模式）边收边播；收到 `tts_final` / `tts_closed` 后 `endOfStream()` 收尾。

**Step 5 — 会话清理**

- 浏览器主动关闭 WS → `main.ts` 的 `close` 回调调用 `unregisterClient` → 关闭腾讯云连接、删除会话
- 应用退出时 `onModuleDestroy` 关闭全部会话

### ttsSessionId 的获取与回传机制（先取后传）

`ttsSessionId` 不是前端生成的，而是**服务端在 WebSocket 连接建立时分配，前端拿到后再回传**：

1. 前端打开 `WS /speech/tts/ws`（不带 sessionId）→ 服务端 `registerClient` 生成随机 UUID
2. 服务端立即回传 `{ type: 'session', sessionId }`
3. 前端收到后保存为 `ttsSessionId`（此时 `ensureTtsConnection()` 才完成）
4. 前端发起 `GET /ai/chat/stream` 时把该 ID 作为 `ttsSessionId` 参数回传
5. `AiController` 从 query 取出 → 经事件总线 emit → `TtsRelayService` 按 `sessions` Map 定位到对应的浏览器 WS 连接，把腾讯云合成的音频分片推回

> 该 ID 是「浏览器 WS 连接」与「AI 对话 SSE 流」之间的**关联键**，仅保存在内存 `sessions` Map 中，不持久化。SSE 请求不携带它时只做文字流式输出、不触发 TTS。

---

## 为什么引入事件总线

### 谁生产、谁消费

- **生产者**：`AiController.chatStream` 发 `start` 事件；`AiService.streamChain` 在流式生成过程中逐分片发 `chunk` / `end` / `error`（仅携带 `ttsSessionId` 时）
- **消费者**：`TtsRelayService` 通过 `@OnEvent(AI_TTS_STREAM_EVENT)` 订阅
- 双方只依赖 `common/stream-events.ts` 中定义的**事件名常量 + 联合类型**，互不引用对方的类

### 核心原因：避免模块强耦合

`AiModule` 与 `SpeechModule` 互不 import（都只依赖全局 `ConfigModule`），两者零依赖：

- 如果不使用事件总线，`AiService` 要触发 TTS 就只能直接注入 `TtsRelayService`，随之而来：
  1. `AiModule` 必须 `import SpeechModule`，两个业务模块被互相咬死
  2. TTS 实现变更时被迫改动 AI 模块
  3. 责任边界模糊：AI 服务需要"知道"TTS 服务的内部方法签名

事件总线把依赖方向反转：**AI 模块只发出「我生成了一个分片」这个消息，谁关心、谁处理，它完全不需要知道**。

### 其他收益

- **1→N 广播、方便扩展**：`EventEmitterModule.forRoot({ maxListeners: 200 })` 预留了多订阅能力。未来想加日志、token 统计等订阅者，只需新增一个 `@OnEvent` 类，**AI 模块一行代码都不用改**
- **贴合流式语义**：AI 输出天然是 `start → chunk* → end/error` 的阶段序列，事件模型与这条流水线一一对应，阅读代码时"谁发出什么信号、谁响应什么"一目了然

### 补充说明

- 事件总线是 **Node 进程内的**（`@nestjs/event-emitter` 基于 EventEmitter2），**不是** Redis/MQ，它解决的是**代码组织与依赖解耦**问题，不承担跨进程通信、消息持久化或削峰
- 代价：多一层间接调用，订阅缺失要运行期才能发现（用事件类型联合兜底了一部分，`TtsRelayService` 中 `if (!session) return` 防呆）

---

## 事件协议（浏览器 ↔ 服务端 TTS WS）

服务端 → 浏览器（文本 JSON）：

| type | 触发时机 |
|---|---|
| `session` | 连接建立后回传 `sessionId` |
| `tts_started` | AI 开始输出，TTS 连接已建立 |
| `tts_final` | 腾讯云合成结束 |
| `tts_closed` | 会话关闭（附 `reason`） |
| `tts_error` | 出错（附 `message`，可选 `code`） |

服务端 → 浏览器（二进制）：mp3 音频分片，直接追加到播放缓冲。

---

## WS 心跳与连接生命周期

当前实现**没有心跳保活机制**：

- 前端 `asr-ai-stream.html`：不发送 ping，`onclose` 仅把 `ttsWs` 置空，**无自动重连**
- 后端 `main.ts`：创建 `WebSocketServer` 时未配置 ping/pong，`TtsRelayService` 也不检测客户端存活

各链路断开的时机与风险：

| 链路 | 断开行为 |
|---|---|
| 浏览器 ↔ 本服务 WS | `ws` 库默认不主动断开空闲连接，理论上可长期保持。但由于**无心跳**，一旦中间经过代理/负载均衡（如 nginx `proxy_read_timeout` 默认 60s、云 LB 常见 60~900s 空闲超时）或 NAT 超时，连接会被**静默断开**，且前端无法及时发现，恢复后需手动重新建立 WS、获取新的 sessionId |
| 本服务 ↔ 腾讯云 TTS WS | 签名有效期 `Expired = now + 3600`（1 小时，官方上限 90 天）；**两次 `ACTION_SYNTHESIS` 发送间隔超过 10 分钟**会被腾讯云断开（错误码 `10009`）；腾讯云会定时下发 `heartbeat=1` 心跳事件，客户端直接忽略即可，无需主动发送心跳 |

腾讯云流式合成其他限制（官方文档）：

- 单会话总合成字数 ≤ **10000 字**
- 服务端按标点（全角 `。；？！`、半角 `; ? !` 及换行）切分句子后合成；文本过短或缺少标点时，会长时间缓存不返回音频

如需长连接保活，可自行补充：服务端定时 `ping()` 并清理未响应 pong 的客户端（`ws` 库官方示例），或前端定时发送任意消息保持链路活跃。

---

## 相关测试项目

仓库根目录下的独立测试脚本（不依赖本服务，直连腾讯云）：

| 脚本 | 作用 |
|---|---|
| `tts-stt-test/src/tts-test.mjs` | 一次性文本合成，输出 `output2.mp3` |
| `tts-stt-test/src/streaming-tts-test.mjs` | 流式合成，边发文本边收音频，输出 `output3.mp3` |
| `tts-stt-test/src/asr-test.mjs` | 本地 mp3 一句话识别 |

---

## 常见问题

- **ASR 报错**：确认腾讯云已开通语音识别服务、密钥正确，音频为 16k 采样且 ≤60 秒
- **TTS 无声音**：确认 `SECRET_ID/SECRET_KEY/APP_ID` 与 `TTS_VOICE_TYPE` 有效；浏览器需支持 MediaSource 与 `audio/mpeg`
- **AI 无回复**：检查 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `MODEL_NAME`，该服务使用 OpenAI 兼容协议，`BASE_URL` 需指向兼容端点
- **WS 一段时间后断开、无音频**：当前无心跳机制，中间代理（nginx / 负载均衡）空闲超时会静默断开连接；确认链路各环节的超时配置，或按上文自行补充心跳保活
- **长时间合成中断**：单会话连续 10 分钟未发送合成文本会被腾讯云断开（`10009`），单会话累计合成字数上限 10000 字
