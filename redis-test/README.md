# redis-test — Redis 实战 + Agent 短期记忆

Redis 入门到落地的两个最小演示：

1. **核心数据类型**（`src/redis-test.mjs`）：用 `ioredis` 实测 String / Hash / List / Set / ZSet 与分布式锁。
2. **Agent 短期记忆**（`src/agent-with-redis-memory.mjs`）：把 Redis 作为 LangChain Agent 的会话记忆存储，消息带 TTL 自动过期，超出阈值由 `summarizationMiddleware` 自动压缩成摘要，实现「聊得再久也不超上下文窗口」。

配套 `docker compose` 一键拉起 Redis 与 RedisInsight 图形管理界面。

## 功能特性

- Redis 六大数据结构实操演示（含真实业务场景注释）
- SET NX EX 分布式锁标准写法
- 记忆以 langchain `StoredMessage` JSON 格式落库（跨进程可读、可迁移）
- 记忆 Key 按会话隔离并带 TTL 自动过期（如 30 分钟无对话自动遗忘）
- 长对话自动摘要压缩：触发阈值 / 保留条数可配置
- RedisInsight 可视化查看记忆数据与 TTL
- 可选 LangSmith 链路追踪

## 技术栈

| 类别 | 选型 |
| ---- | ---- |
| 运行时 | Node.js、npm |
| Redis | redis:7-alpine（Docker） |
| Redis 驱动 | `ioredis` |
| LLM | LangChain.js（`@langchain/openai`，OpenAI 兼容接口） |
| Agent 框架 | `langchain`（createAgent + summarizationMiddleware） |
| 可选追踪 | LangSmith（`LANGCHAIN_TRACING_V2`） |

## 目录结构

```
redis-test/
├── docker-compose.yml              # Redis + RedisInsight 编排
├── .env.example                    # 环境变量模板（cp .env.example .env）
├── package.json
├── redis-data-types.md             # Redis 数据类型速查手册（学习笔记）
├── redis-data-types.png            # 类型速查截图
├── agent-memory.png                # Agent 记忆架构示意图
└── src/
    ├── redis-test.mjs              # Demo 1：五种核心类型 + 分布式锁
    └── agent-with-redis-memory.mjs # Demo 2：Agent 对话 + Redis 短期记忆
```

## 快速开始

### 1. 启动 Redis

```bash
docker compose up -d
```

- Redis：容器 `agent_redis`，端口 `6379`，开启 AOF 持久化（`--appendonly yes`）
- RedisInsight：http://localhost:5540 （Redis 官方 Web GUI）
- 数据持久化在 `volumes/redis` 与 `volumes/redisinsight`

#### RedisInsight 可视化连接（首次需手动添加数据库）

浏览器打开 `http://localhost:5540` 进入 RedisInsight。注意：**首次使用并不会直接看到数据**，需要先点击 `Add Redis database` 手动添加一个数据库，关键字段如下：

| 字段 | 填写 | 说明 |
| ---- | ---- | ---- |
| Host | `host.docker.internal` | **不能写 `127.0.0.1`**。RedisInsight 和 Redis 都跑在 Docker 容器里，容器内的 `127.0.0.1` 指向的是它自己而不是你的电脑；`host.docker.internal` 是 Docker Desktop 提供的「宿主机」别名，会先回宿主、再经宿主机的 `6379` 端口转发到 `agent_redis` 容器 |
| Port | `6379` | Redis 映射到宿主机的端口，保持默认即可 |
| Database Alias | 随意（如 `agent_redis`） | 仅用于界面展示，便于区分多个连接 |
| Username | **留空** | `Username` 是 Redis Cloud 等云托管版的鉴权字段，**本地自建的 Redis 不需要填**，填了反而会导致连接失败 |
| Password | 留空 | 本示例的 Redis 未开启 `requirepass` |

填写后点击 `Test Connection` 校验，通过后点 `Save Database` 保存。连接成功后即可在界面中浏览 `agent:short_memory:*` 等 key、查看消息内容与其剩余 TTL。

> 小提示：`host.docker.internal` 依赖 Docker Desktop（Windows / macOS）的宿主别名机制。若不可用，由于两容器同处 `common-network`，也可把 Host 直接填容器名 `agent_redis`、Port 填 `6379`，走容器内网同样能连通。

### 2. 运行 Demo 1：核心数据类型

直连 `localhost:6379`，无需任何配置：

```bash
node src/redis-test.mjs
```

依次输出 String / Hash / List / Set / ZSet / 分布式锁的执行结果。
配套速查手册见 [redis-data-types.md](./redis-data-types.md)。

### 3. 运行 Demo 2：Agent 短期记忆

需要配置模型密钥。复制模板并填写：

```bash
cp .env.example .env
```

关键项：`OPENAI_API_KEY`、`MODEL_NAME`（默认 `qwen-plus`）、`OPENAI_BASE_URL`。

```bash
npm run agent:redis-memory
```

进入交互式对话。对话历史自动存取于 Redis：

```
你: 我叫张三，家住杭州
你: 你还记得我叫什么吗？      # 跨轮记忆生效
你: 我住哪座城市？            # 长对话触发摘要压缩后可继续回答
exit                          # 退出；:clear 清空记忆
```

## 环境变量

| 变量 | 默认值 | 说明 |
| ---- | ---- | ---- |
| `OPENAI_BASE_URL` | 无 | OpenAI 兼容网关（如 DashScope） |
| `MODEL_NAME` | `qwen-plus` | 对话模型名 |
| `OPENAI_API_KEY` | 无 | 模型服务密钥 |
| `LANGCHAIN_API_KEY` | 无 | LangSmith 密钥（不填则关闭追踪） |
| `LANGCHAIN_PROJECT` | `redis-test` | LangSmith 项目名 |
| `LANGCHAIN_TRACING_V2` | `false` | 置 `true` 开启追踪 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | `localhost` / `6379` / `0` | Redis 连接 |
| `MEMORY_KEY_PREFIX` | `agent:short_memory` | 记忆 key 前缀 |
| `MEMORY_SESSION_ID` | `demo_user_001` | 会话标识，多开可模拟多用户隔离 |
| `MEMORY_TTL_SECONDS` | `1800` | 记忆过期秒数（30 分钟） |
| `CLEAR_MEMORY` | 空 | 置 `1` 启动时清空该会话历史（示例默认注释） |

## Redis 记忆的设计

```
┌────────────┐   invoke 前    ┌────────────────────────────┐
│  用户输入   │ ─────────────► │ RedisMessageStore.load()    │
└────────────┘                │  agent:short_memory:<sid>:messages
                              └──────────────┬─────────────┘
                                             │ 历史 + 新消息
                                             ▼
                                   ┌────────────────────┐
                                   │ Agent (createAgent) │──► 消息 ≥ 8 条时
                                   │ summarizationMiddleware│ 自动压缩为摘要
                                   └──────────┬─────────┘
                                              │ 返回 messages
                                              ▼
                              ┌────────────────────────────┐
                              │ RedisMessageStore.save()    │── 写回并刷新 TTL
                              └────────────────────────────┘
```

关键点：

- **Key 设计**：`<MEMORY_KEY_PREFIX>:<SESSION_ID>:messages`，例如 `agent:short_memory:demo_user_001:messages`，不同会话天然隔离。
- **TTL 过期**：每轮写回都会刷新过期时间，超过 `MEMORY_TTL_SECONDS` 未对话即自动遗忘，无需手动清理。
- **摘要压缩**：`summarizationMiddleware` 参数 `trigger: { messages: 8 }`（达到 8 条触发）、`keep: { messages: 4 }`（压缩后保留最近 4 条 + 摘要），既保留关键上下文又不撑爆上下文窗口。
- **换模型**：摘要与对话共用 `MODEL_NAME`，只改 `.env` 一处即可全局生效。

## 相关项目

- [memory-test](../memory-test/)：LangChain 内存管理的系统实验（截断 / 摘要 / 检索三种策略）
- [pgsql-test](../pgsql-test/)：PostgreSQL(pgvector) 作为持久化记忆 / 向量检索的方案
