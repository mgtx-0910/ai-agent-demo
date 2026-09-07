# mem0-test

Mem0「记忆层」的 Node.js 实践示例集。从云端 API 基础调用、三种记忆 scope，
到「Redis 短期记忆 + Mem0 长期记忆」的分层 Agent，逐步演示如何给 LLM 应用接入记忆。

## 目录结构

```
mem0-test/
├── docker-compose.yml                 # Redis + RedisInsight（GUI）
├── package.json
└── src/
    ├── mem0-test.mjs                  # ① 云端 MemoryClient 基础 CRUD 演示
    ├── mem0-scoped-memory-test.mjs    # ② 三种 scope（user/session/agent）测试
    ├── mem0-local-api-demo.mjs        # ③ 本地部署版 mem0 OpenAPI 调用演示
    └── mem0-redis-mem0-agent.mjs      # ④ 分层记忆 Agent（Redis 短期 + Mem0 长期）
```

## 两个前置

### 1. 配置 `.env`

在 `mem0-test` 目录新建 `.env`（可参考工作区其它示例）。按演示需要选择变量：

| 变量 | 说明 | 用到的脚本 |
|---|---|---|
| `MEM0_API_KEY` | Mem0 云端 API Key（[platform.mem0.ai](https://platform.mem0.ai)） | ① ② ④ |
| `MEM0_LOCAL_API_KEY` | 本地 mem0 服务鉴权 Key（服务端未开鉴权可留空） | ③ |
| `OPENAI_API_KEY` | 大模型 API Key | ④ |
| `OPENAI_BASE_URL` | 大模型兼容接口地址（OpenAI 兼容即可） | ④ |
| `MODEL_NAME` | 对话模型名 | ④ |
| `MEM0_USER_ID` | Agent 演示的默认用户（默认 `demo_user_001`） | ④ |
| `MEM0_TOP_K` | 记忆检索条数（默认 5） | ④ |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | Redis 连接（默认 `localhost:6379 db0`） | ④ |
| `MEMORY_TTL_SECONDS` | Redis 短期消息过期秒数（默认 1800） | ④ |
| `MEMORY_KEY_PREFIX` | Redis key 前缀（默认 `agent:short_memory`） | ④ |

### 2. 启动 Redis

```bash
docker compose up -d
```

会启动两个容器：

- `redis-mem0-test`：Redis 7，映射 `6379`（短期记忆 + mem0 后端向量库用）
- `redisinsight-mem0-test`：Redis 官方 Web GUI，映射 `5540`

> 端口冲突提示：若你已用 `redis-test` 的 `docker compose up -d` 启动了 `agent_redis`
> （同样占用宿主 `6379`），这里会 bind 失败。两个项目选一个启用，或修改本文件的
> `ports`（例如 `"6380:6379"`）并把 `.env` 的 `REDIS_PORT` 改成 `6380`。

## 示例说明与运行

> 命令均可直接用 `node src/xxx.mjs` 跑；`package.json` 也封装了同名 npm script。

### ① `mem0-test.mjs` — 云端 API 基础 CRUD

MemoryClient（云端）的 add / search / getAll / get / update / history / deleteAll 演示。
默认只跑 search（避免反复写线上记忆），取消文件内对应注释即可逐个体验。

```bash
npm start                  # 搜索演示
npm run cleanup            # 删除 demo-user 的全部记忆
```

### ② `mem0-scoped-memory-test.mjs` — 三种 scope

验证 Mem0 的三个记忆归属维度与相互隔离：

- `user_id`：用户长期记忆（换会话仍认得用户）
- `run_id`：单次会话 / 任务记忆
- `agent_id`：Agent 自身属性记忆（角色、回答风格）

```bash
npm run scoped-memory             # 分别向三种 scope add 一条记忆
npm run scoped-memory:search      # 分别 search 验证归属
npm run scoped-memory:cleanup     # 清理三种 scope 测试数据
```

### ③ `mem0-local-api-demo.mjs` — 本地 mem0 OpenAPI

`mem0ai` SDK 面向云端；本地 docker 起的 mem0 服务（默认 `http://localhost:8888`）
使用 OpenAPI 风格接口。本示例用自写的 `LocalMem0Client`（fetch 封装）
直接调用 `POST /memories`、`GET /memories`、`POST /search`、`DELETE /memories`。

```bash
npm run local-api              # add：写入一组示例对话
npm run local-api:search       # 语义搜索
npm run local-api:list         # 列出该用户全部记忆
npm run local-api:cleanup      # 清理
```

### ④ `mem0-redis-mem0-agent.mjs` — 分层记忆 Agent

**Redis 记这轮聊天，Mem0 记值得长期留着的事。**

- 会话层（Redis）：agent 当前 session 的完整消息历史，带 TTL，超 8 条由
  `summarizationMiddleware` 压缩成摘要（保留最近 4 条）
- 用户层（Mem0 `user_id`）：跨会话的长期事实（姓名、居住地、饮食禁忌等）
- 会话层（Mem0 `run_id`）：仅当前会话有效的任务、进度、待办

每轮对话先并行检索两层记忆注入 SystemMessage，回答后由一个结构化输出分类器
（zod schema）判断本轮是否有新事实、该写哪一层，再写入 Mem0。

```bash
npm run agent
```

交互命令：`exit / quit / :q` 退出；`:clear` 清空 Redis 短期记忆；
`:clear-mem0` 清空 Mem0 用户层与当前会话层。

文件末尾附有完整的分层测试对话（寒暄 / 自我介绍 / 当前任务 / 重启验证 user 层），
可直接复制进终端体验。

## 依赖安装

```bash
npm install
```

> 若安装 `better-sqlite3` 时提示 `'node' is not recognized`，说明 fnm/Node
> 不在 PATH 中，先执行：`$env:Path = "<fnm node 安装目录>;" + $env:Path` 再安装。

## 数据清理

```bash
# 记忆数据
npm run cleanup              # ① 云端 demo-user
npm run scoped-memory:cleanup
npm run local-api:cleanup

# 容器数据（连 volumes 一起删除）
docker compose down -v
```
