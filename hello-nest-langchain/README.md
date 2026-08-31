# hello-nest-langchain

基于 **NestJS + LangChain** 的集成入门示例，演示如何在 NestJS 项目中接入 LangChain 构建 AI 对话接口，并提供标准的 RESTful CRUD 模块作为分层架构参考。

## 功能特性

- **AI 对话模块（`ai/`）**：用 LangChain 的 `prompt.pipe(model).pipe(parser)` 构建 Runnable 链
  - `GET /ai/chat`：一次性返回完整回答
  - `GET /ai/chat/stream`：SSE 流式逐字返回
- **图书管理模块（`book/`）**：标准 Controller → Service → Repository 分层
  - 提供完整 RESTful CRUD（`POST/GET/PATCH/DELETE /book`）
  - 通过自定义 Provider 注入内存仓库（预置 3 本书），便于后续无缝替换为真实数据库
- **依赖注入示范**：`useFactory` 从 `.env` 读取配置创建 `ChatOpenAI` 实例，以 `CHAT_MODEL` 令牌注入
- **Swagger / OpenAPI**：附带 `generate:openapi` 脚本导出接口文档

## 目录结构

```
hello-nest-langchain/
├── .env.example                 # 环境变量示例
├── openapi.json                 # 生成的 OpenAPI 文档
└── src/
    ├── main.ts                  # 启动入口
    ├── app.module.ts            # 根模块
    ├── ai/                      # AI 对话模块
    │   ├── ai.module.ts         #   CHAT_MODEL 工厂注入
    │   ├── ai.controller.ts     #   GET /ai/chat、GET /ai/chat/stream
    │   └── ai.service.ts        #   Runnable 链（invoke / stream）
    └── book/                    # 图书 CRUD 模块
        ├── book.module.ts       #   BOOK_REPOSITORY 工厂注入
        ├── book.controller.ts   #   RESTful 接口
        ├── book.service.ts      #   业务逻辑（内存仓库）
        ├── dto/                 #   创建 / 更新 DTO
        └── entities/            #   图书实体
```

## 快速开始

### 1. 环境要求

- Node.js 18+
- 可访问的 OpenAI 兼容模型端点（如通义千问 DashScope）

### 2. 安装依赖

```bash
pnpm install   # 或 npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

| 变量 | 说明 | 示例 |
|---|---|---|
| `OPENAI_API_KEY` | 模型 API 密钥 | `sk-xxx` |
| `OPENAI_BASE_URL` | OpenAI 兼容端点 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `MODEL_NAME` | 模型名 | `qwen-plus` |

### 4. 启动服务

```bash
pnpm run start:dev    # 开发模式（热重载）
# 或
pnpm run start        # 普通启动
```

默认监听 `3000` 端口。

### 5. 验证

```bash
# 一次性回答
curl 'http://localhost:3000/ai/chat?question=你好'

# 流式回答
curl -N 'http://localhost:3000/ai/chat/stream?question=你好'

# 图书 CRUD
curl -X POST http://localhost:3000/book -H 'Content-Type: application/json' \
  -d '{"title":"天龙八部","author":"金庸"}'
curl http://localhost:3000/book
```

## 接口说明

### AI 对话

| 接口 | 说明 |
|---|---|
| `GET /ai/chat?question=...` | 一次性返回模型回答 |
| `GET /ai/chat/stream?question=...` | SSE 流式逐字返回回答 |

### 图书管理

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/book` | 创建图书（`title`、`author`） |
| `GET` | `/book` | 查询全部 |
| `GET` | `/book/:id` | 按 ID 查询 |
| `PATCH` | `/book/:id` | 部分更新 |
| `DELETE` | `/book/:id` | 删除 |

## 生成 OpenAPI 文档

```bash
pnpm run generate:openapi
```

会在项目根目录生成 `openapi.json`。
