# TTS & STT Test

腾讯云语音能力的独立测试脚本集，覆盖「**语音合成（TTS）**」与「**语音识别（ASR）**」两条链路，用于验证 API 参数、签名逻辑与接口行为：

- **一句话合成**：`TextToVoice`（官方 SDK，一次性返回完整音频）
- **流式合成**：`TextToStreamAudioWSv2`（WebSocket，分段发送文本、边合成边接收音频分片，低延迟）
- **一句话识别**：`SentenceRecognition`（官方 SDK，把本地音频转回文本）

> 定位：`asr-and-tts-nest-service` 的底层能力沙盒。主项目里的 TTS 中继签名逻辑、`ACTION_SYNTHESIS` / `ACTION_COMPLETE` 协议，都源于这里的流式脚本验证。

---

## 目录结构

```
tts-stt-test/
├── .env.example              # 环境变量示例（SECRET_ID / SECRET_KEY / APP_ID）
├── package.json              # 依赖：官方 SDK、ws、dotenv
└── src/
    ├── tts-test.mjs          # 一句话语音合成（TextToVoice）
    ├── streaming-tts-test.mjs# 流式语音合成（TextToStreamAudioWSv2 / WebSocket）
    └── asr-test.mjs          # 一句话语音识别（SentenceRecognition）
```

## 快速开始

### 1. 环境要求

- Node.js 18+
- 腾讯云账号（开通**语音识别**与**语音合成**服务，获取 `SECRET_ID` / `SECRET_KEY` / `APP_ID`）

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

| 变量 | 说明 | 示例 |
|---|---|---|
| `SECRET_ID` | 腾讯云 API 密钥 ID | `xxx` |
| `SECRET_KEY` | 腾讯云 API 密钥 Key | `xxx` |
| `APP_ID` | 腾讯云应用 ID（仅流式合成需要） | `1300060157` |

### 4. 运行脚本

```bash
node src/tts-test.mjs            # 一句话合成 → output2.mp3
node src/streaming-tts-test.mjs  # 流式合成   → output3.mp3
node src/asr-test.mjs            # 识别 output3.mp3 → 打印识别文本
```

---

## 脚本说明

### 1. 一句话合成 `src/tts-test.mjs`

通过官方 SDK `tencentcloud-sdk-nodejs-tts` 调用 `TextToVoice` 接口，把整段文本**一次性**合成为音频：

```
文本 → TextToVoice → Base64 Audio → Buffer → 本地 output2.mp3
```

- 区域 `ap-beijing`，端点 `tts.tencentcloudapi.com`
- 音色 `502006`（精品音色），编码 `mp3`
- 适合短文本、对延迟不敏感的场景；文本过长或需边生成边播时用流式方案

### 2. 流式合成 `src/streaming-tts-test.mjs`

不走 REST API，而是通过 WebSocket 调用 `TextToStreamAudioWSv2`：客户端**分段发送文本**，服务端**边合成边回传音频分片**，实现低延迟流式合成：

```
分段文本 → WebSocket(TextToStreamAudioWSv2) → 音频分片 → 本地 output3.mp3
```

关键逻辑：

- **签名**：参数按 key 字典序排序 → 键值 URL 编码（RFC 3986 严格模式，`!'()*` 也转义）拼接 → 拼上 `GETtts.cloud.tencent.com/stream_wsv2?` → HMAC-SHA1 → Base64 → 签名值再编码后拼到 URL
- **时序**：连接建立后等服务端下发 `ready === 1` → 才开始逐段发送 `ACTION_SYNTHESIS`（每段间隔 3s 模拟流式输入）→ 全部发完发送 `ACTION_COMPLETE` 收尾
- **收包**：二进制消息为 mp3 音频分片直接写文件；收到 `final === 1` 表示合成结束
- 音色 `101001`（智瑜，女声）

### 3. 一句话识别 `src/asr-test.mjs`

通过官方 SDK `tencentcloud-sdk-nodejs` 调用 `SentenceRecognition` 接口，把本地音频识别为文本：

```
本地 output3.mp3 → Base64 → SentenceRecognition → 识别文本（控制台打印）
```

- 区域 `ap-shanghai`，引擎 `16k_zh`（16k 采样率中文）
- 默认读取 `./output3.mp3`（即流式合成脚本的产物），可改为任意 60 秒内短音频
- 数据来源 `SourceType = 1`（音频直接作为请求参数）

---

## 三条链路的组合使用

把 TTS 与 ASR 串起来即可验证「**合成 → 识别**」闭环：

```
streaming-tts-test.mjs  ──产出──▶  output3.mp3  ──输入──▶  asr-test.mjs  ──打印──▶ 识别文本
```

预期识别结果与 `streaming-tts-test.mjs` 中的 `TEXTS` 文案基本一致，可用来验证同一条文本经过「合成→识别」后的保真度。

---

## 常见问题

- **提示凭证缺失**：确认 `.env` 已配置且与 `.env.example` 字段一致；流式脚本还会校验 `APP_ID`
- **签名报错（`AuthFailure` / `SignatureDoesNotMatch`）**：重点检查签名串的 URL 编码——腾讯云要求 `!'()*` 也转义、空格用 `%20`，且 URL 中的参数串必须与签名串完全一致
- **识别结果为空或乱码**：确认 `VoiceFormat` 与音频实际编码一致（本项目统一 `mp3`）、采样率与引擎匹配（`16k_zh` 对应 16k）
- **`asr-test.mjs` 找不到文件**：先运行 `streaming-tts-test.mjs` 生成 `output3.mp3`，或修改 `AUDIO_FILE` 指向现有音频
