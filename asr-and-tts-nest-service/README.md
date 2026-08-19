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
│              │  ② 建立 TTS 通道
│              │ ────────────▶ WS /speech/tts/ws（带 sessionId 注册会话）
│              │
│              │  ③ 发起 AI 流式对话
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

服务端 `main.ts` 在连接建立时把客户端注册到 `TtsRelayService`，并向客户端回传会话信息。

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

**Step 2 — 建立 TTS 通道**

1. 前端打开 `WS /speech/tts/ws`（无 sessionId）
2. `main.ts` 的 `connection` 回调调用 `ttsRelayService.registerClient(socket)` → 服务端生成随机 `sessionId`，以 JSON 消息 `{ type: 'session', sessionId }` 回传
3. 前端保存 `ttsSessionId`，后续请求复用同一连接（支持多轮连续对话）

**Step 3 — 发起 AI 流式对话（带 TTS 联动）**

1. 前端用 `EventSource` 请求 `GET /ai/chat/stream?query=<识别文本>&ttsSessionId=<sessionId>`
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
