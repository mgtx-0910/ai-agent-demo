# multi-modal-agent —— 多模态 AI 调用合集

一个学习向的「多模态能力全家桶」：**图像 / 音频 / 视频的理解，图像 / 视频的生成，外加一条 OSS 前端直传链路**，每个脚本对应一类真实业务场景。

```
                    ┌───────────── 理解（看懂）─────────────┐
 图片 ──► image-understanding.mjs   (qwen-vl-plus)
 音频 ──► audio-understanding.mjs   (qwen3.5-omni-flash)
 视频 ──► video-understanding.mjs   (qwen3.5-omni-flash)

                    ┌───────────── 生成（造出来）───────────┐
 文字 ──► wan/text-to-image.mjs     (wan2.6-t2i)      ──► png
 图+字 ─► wan/image-edit.mjs        (wan2.6-image)    ──► png
 文字 ──► wan/text-to-video.mjs     (wan2.6-t2v)      ──► mp4
 图片 ──► wan/image-to-video.mjs    (wan2.6-i2v-flash)──► mp4

                    ┌───────────── 存储（传上去）───────────┐
 sts-gen.mjs（签发凭证） ──► public/index.html（浏览器直传 OSS）
```

## 最重要的一个认知：两条调用路线

阿里云百炼（DashScope）对外的接口**不是一套**，理解类和生成类走的是两条完全不同的路：

| | **OpenAI 兼容模式** | **DashScope 原生 SDK** |
|---|---|---|
| 入口 | `new ChatOpenAI({ baseURL })` | `new MultiModalConversation()` / `new VideoSynthesis()` |
| 依赖 | `@langchain/openai` + `@langchain/core` | `dashscope-sdk-official` |
| 覆盖模型 | 对话 / **理解**类：`qwen-vl-plus`、`qwen3.5-omni-flash` | **生成**类：万相 `wan2.6-*` 全系列 |
| 消息格式 | `content: [{ type: 'image_url' \| 'input_audio' \| 'video_url' }]` | `content: [{ text } \| { image }]` |
| 有图片生成能力吗 | ❌ 不覆盖 | ✅ 只有它支持 |
| 错误处理 | SDK 直接抛异常 | **不抛异常**，需自己检查 `status_code` / `code` / `task_status` |

> 一句话：**「问模型问题」用兼容模式，写起来最省事；「让模型产出图片/视频」必须用原生 SDK。**

## 脚本清单

| 脚本 | 能力 | 模型 | 路线 | 产出 |
|---|---|---|---|---|
| `src/image-understanding.mjs` | 图像理解：描述图片内容 | `qwen-vl-plus` | 兼容模式 | 控制台文本 |
| `src/audio-understanding.mjs` | 音频理解：识别说了什么 | `qwen3.5-omni-flash` | 兼容模式 | 控制台文本 |
| `src/video-understanding.mjs` | 视频理解：总结视频内容 | `qwen3.5-omni-flash` | 兼容模式 | 控制台文本 |
| `src/wan/text-to-image.mjs` | 文生图 | `wan2.6-t2i` | 原生 SDK | `output-wan-text-to-image.png` |
| `src/wan/image-edit.mjs` | 图像编辑：按指令改图 | `wan2.6-image` | 原生 SDK | `output-wan-image-edit.png` |
| `src/wan/text-to-video.mjs` | 文生视频 | `wan2.6-t2v` | 原生 SDK | `output-wan-text-to-video.mp4` |
| `src/wan/image-to-video.mjs` | 图生视频：让图片动起来 | `wan2.6-i2v-flash` | 原生 SDK | `output-wan-image-to-video.mp4` |
| `src/sts-gen.mjs` | 生成 OSS 前端直传凭证 | — | `ali-oss` | 控制台输出 signature + host |
| `public/index.html` | 浏览器直传 OSS 并预览 | — | `axios` | 页面上显示图片 |

## 目录结构

```
multi-modal-agent/
├── src/
│   ├── image-understanding.mjs     # 图像理解（兼容模式 + ChatOpenAI）
│   ├── audio-understanding.mjs     # 音频理解（兼容模式 + ChatOpenAI）
│   ├── video-understanding.mjs     # 视频理解（兼容模式 + ChatOpenAI）
│   ├── sts-gen.mjs                 # OSS 直传签名（服务端签发凭证）
│   └── wan/                        # 万相生成类（原生 SDK）
│       ├── text-to-image.mjs       # 文生图
│       ├── image-edit.mjs          # 图像编辑
│       ├── text-to-video.mjs       # 文生视频
│       └── image-to-video.mjs      # 图生视频
├── public/
│   └── index.html                  # 前端直传演示页（配合 sts-gen.mjs）
├── .env.example                    # 环境变量模板（复制为 .env）
└── package.json
```

## 快速开始

前置：Node.js 20+ 与一个可用的 DashScope（百炼）API Key。

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量
cp .env.example .env      # Windows: copy .env.example .env
#   填入 OPENAI_API_KEY（DashScope 的 Key）
#   跑 OSS 直传时再填 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
```

### 运行理解类脚本

```bash
node src/image-understanding.mjs   # 图像理解
node src/audio-understanding.mjs   # 音频理解
node src/video-understanding.mjs   # 视频理解（耗时较长）
```

三个脚本用的都是公网示例素材（阿里云文档站的图片/音频/视频），**无需自备文件**。

### 运行生成类脚本

```bash
node src/wan/text-to-image.mjs     # 文生图  → output-wan-text-to-image.png
node src/wan/image-edit.mjs        # 图像编辑 → output-wan-image-edit.png
node src/wan/text-to-video.mjs     # 文生视频 → output-wan-text-to-video.mp4（较慢）
node src/wan/image-to-video.mjs    # 图生视频 → output-wan-image-to-video.mp4（较慢）
```

生成结果会以**临时 URL** 返回，脚本会自动下载并保存到项目根目录。

## OSS 前端直传链路（`sts-gen.mjs` + `public/index.html`）

这是一条与「多模态」无关、但同样常见的工程链路：**让浏览器把文件直接传给 OSS，不经过自己的服务器**。

```
服务端（可信）                          浏览器（不可信）
──────────────────                     ──────────────────
sts-gen.mjs
  ├─ 用主账号 AK/SK
  ├─ calculatePostSignature()
  │     ├─ expiration（过期时间）
  │     └─ conditions（如文件大小上限）
  └─ 输出 ──────────► policy + signature + AccessKeyId + host
                                        │
                                        ▼
                              index.html 组装 FormData
                                key / policy / signature /
                                OSSAccessKeyId / file
                                        │
                                        ▼ POST
                              http://<bucket>.<region>.aliyuncs.com
                                        │
                                        ▼
                              OSS 校验签名 → 落盘 → 回显图片
```

FormData 各字段含义（一个都不能少）：

| 字段 | 说明 |
|---|---|
| `key` | 对象名（桶内路径）。当前直接用文件名，**同名会覆盖**，且落在桶根目录 |
| `OSSAccessKeyId` | 主账号 AK ID，必须与签名使用的一致 |
| `policy` | 服务端生成的策略（含过期时间、大小限制），base64 编码 |
| `signature` | 对 policy 的签名，OSS 用它验真 |
| `success_action_status` | 设为 `200` 让 OSS 返回 200（默认 204），便于前端判断 |
| `file` | 文件本体，**必须放最后** |

运行方式：

```bash
# 1. 生成一份新的上传凭证（1 天后过期）
node src/sts-gen.mjs

# 2. 起一个静态服务器打开页面（不要直接双击打开，file:// 会触发跨域问题）
npx serve public
```

> ⚠️ `public/index.html` 里写死的凭证是**示例数据**，其中 policy 的过期时间（2026-07-06）**早已失效**，实际使用时必须换成 `sts-gen.mjs` 现场输出的值。
>
> 该页面还依赖 bucket 上的**跨域规则**（允许来源、允许 `POST`、允许相关请求头），否则浏览器会直接拒绝请求。

## 关键概念速查

- **多模态消息**：理解类脚本的 `content` 是一个**数组**，按顺序放文本与媒体元素——这就是「多模态」在代码层面的样子。
- **理解的三种媒体元素**：图片 `image_url`、音频 `input_audio`、视频 `video_url`。
- **`size` vs `resolution`**：文生视频用 `size: '1280*720'`（宽`*`高）；图生视频用 `resolution: '720P'`。两者不可互换，写错会直接报参数错误。
- **`enable_interleave`**：`wan2.6-image` 的模式开关，`false` = 图像编辑，`true` = 图文混排生成。
- **异步任务**：视频生成是「提交任务 → 轮询状态 → 取结果」，`VideoSynthesis.call()` 已把轮询封装，所以脚本会阻塞几十秒到几分钟。
- **结果 URL 有时效**：生成的图片/视频 URL 会过期，必须在本地及时下载保存。
- **原生 SDK 不抛异常**：业务失败只体现在 `status_code` / `code` / `task_status` 字段里，必须手动判断。
- **`sts-gen` 这个名字的误导**：它用的是 **PostObject 表单直传**（`calculatePostSignature`），不是真正的 STS（`assumeRole` 换临时 AK/SK/Token）。两者都能实现前端直传，本项目演示的是更简单的 Post 方案。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| `Cannot find module '@langchain/openai'` | 依赖没装：先 `npm install` |
| `node` / `npm` 命令找不到 | 本机 Node 由 fnm 管理，未激活：先 `fnm use 24.19.0` |
| 401 / `InvalidApiKey` | `.env` 里的 `OPENAI_API_KEY` 未填，或填的不是 DashScope 的 Key |
| 理解类脚本报 404 / model not found | `OPENAI_BASE_URL` 没指向兼容模式地址（`.../compatible-mode/v1`） |
| 生成类脚本报 `model not exist` | 万相模型不在 OpenAI 兼容模式内，必须用原生 SDK；同时确认账号已开通该模型 |
| 生成类脚本「成功了但没图」 | 原生 SDK 不抛异常，需检查 `result.status_code` / `result.code` |
| 视频脚本等很久 | 异步任务正常现象，等待轮询完成即可 |
| 参数校验失败（size / resolution） | 文生视频传 `size`，图生视频传 `resolution`，别混用 |
| 下载生成结果报 403 | 结果 URL 已过期，需在有效期内下载 |
| 前端直传报 CORS 错误 | bucket 未配置跨域规则；另建议用 `npx serve public` 打开而非 `file://` |
| 前端直传报 `SignatureDoesNotMatch` | policy/signature 过期，或 `host` 与签名所属 bucket/region 不一致 → 重跑 `sts-gen.mjs` |
| 上传成功但图片显示 403 | bucket 非公共读，预览需改用带签名的 URL |

## 备注

- **安全**：`.env`（含真实 AK/SK 与 API Key）已在 `.gitignore` 中排除，**切勿提交**；`sts-gen.mjs` 输出的凭证也应设短有效期并只下发给受信前端。
- **密钥复用**：所有脚本统一读 `OPENAI_API_KEY` 作为 DashScope Key（兼容模式与原生 SDK 用的是同一个 Key），保持 `.env` 简洁。
- **产物文件**：`output-*` 是运行产物（图片/视频体积较大），已在 `.gitignore` 中排除，不会误提交进仓库。
- **阅读顺序建议**：先看 `image-understanding.mjs` 理解「兼容模式 + 多模态消息」，再看 `wan/text-to-image.mjs` 体会「原生 SDK 的差异」，最后看 `sts-gen.mjs` + `index.html` 了解 OSS 直传。
- 脚本内部均带逐行教学注释，解释了每个参数与「为什么这么写」，遇到疑问可直接对照源码。
