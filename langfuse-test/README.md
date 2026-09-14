# Langfuse Test —— Deep Agents 链路追踪 + Dataset 评测

用 **Deep Agents** 跑一个「查天气 + 计算器」的 Agent，把 LLM / 工具调用的完整调用链 Trace 到 **Langfuse**；
再用 Langfuse 的 **Dataset + Experiment** 对同一个 Agent 做一键离线评测，把得分沉淀成可对比的 Run。

一句话概括这个模块的两件事：

| 能力 | 命令 | 入口文件 | 在 Langfuse 看什么 |
| --- | --- | --- | --- |
| **在线观测**：一次运行到底调了什么、慢在哪 | `npm run demo` | `src/index.mjs` | Traces、Sessions |
| **离线评测**：一批用例上表现如何、能不能横向比 | `npm run eval` | `src/evaluate.mjs` | Datasets、Runs、Scores |

> 观测解决「**看见**」（把黑盒执行变成可回放的调用树），评测解决「**量出来**」（把主观好不好变成可对比的分数）。
> 两者共用同一个 Agent（`src/agent.mjs`），所以评测分数能代表你在观测里看到的那个 Agent 的真实表现。

## 概念速览

先认识 Langfuse 里的几个词，后面读代码会顺很多：

| 术语 | 含义 | 本模块中的对应物 |
| --- | --- | --- |
| **Trace** | 一次完整请求的调用树（根节点） | 一次 `agent.invoke(...)` |
| **Span** | Trace 里的一个节点（链 / 工具 / 任意代码段） | Agent 图节点、`get_weather` / `calculate` 工具调用 |
| **Generation** | 特殊 Span：一次 LLM 调用 | 每轮模型推理（含 prompt / completion / token 数） |
| **Session** | 多条 Trace 的分组（会话 / 批次） | demo 用固定 `deepagents-demo`；评测用 `eval-<dataset>` |
| **Dataset** | 评测集，由若干 item 组成 | `deepagents-eval` |
| **Experiment / Run** | 在某个 Dataset 上跑一次 task + evaluators | 每次 `npm run eval` 生成一条 Run |
| **Score** | 打分结果（数值 / 类别 / 布尔 + comment） | `keyword_hit`、`non_empty`、`avg_keyword_hit` |
| **Evaluator** | 打分函数（item 级或 run 级） | `keywordHitEvaluator` 等四个函数 |

## 整体链路

Trace 能出现在 Langfuse，靠的是「**OTEL 铺管道**」+「**CallbackHandler 产生 span**」两段协作，缺一不可：

```
npm run demo  →  src/index.mjs
  │
  │ ① 第一行：import "./instrumentation.mjs"          ← 铺管道，必须最先执行
  │      ├─ dotenv/config                             加载 .env → process.env
  │      ├─ new LangfuseSpanProcessor({ ... })        span 往哪发 / 以什么节奏发（immediate）
  │      └─ new NodeSDK({ spanProcessors }).start()   从此 OTEL 全局生效
  │
  │ ② createAgent()           src/agent.mjs：get_weather + calculate + Deep Agent
  │ ③ new CallbackHandler()   LangChain 回调 → Langfuse span 的桥
  ▼
agent.invoke(..., { callbacks: [handler] })           ← 挂上 callbacks 才会产生 span
  │
  ├─ LLM 调用  → generation span ─┐
  ├─ 工具调用  → tool span ───────┤ 全部交给 OTEL
  └─ 多轮循环：查天气 → 查天气 → 相加 → 总结
                                  ▼
                     LangfuseSpanProcessor → Langfuse 服务端
                                  ▲
  ④ langfuse.flush() ────────────┤   管理 API（Dataset / Score）走另一条通道
     shutdownTracing() ───────────┘   收尾 flush，防止进程退出前丢 span
```

**两个最容易踩的坑都在图里**：

1. 少了 `import "./instrumentation.mjs"`（或位置不对）→ 管道没铺好，span 静默丢失
2. 少了 `callbacks: [handler]` → 管道是通的，但没有任何 span 产出

## 项目结构

```
langfuse-test/
├── src/
│   ├── instrumentation.mjs   # ① 埋点初始化：OTEL + LangfuseSpanProcessor（必须最先加载）
│   ├── agent.mjs             # ② 被测 Agent 工厂：get_weather / calculate + Deep Agent（demo 与 eval 共用）
│   ├── index.mjs             # ③ 单次调用 Demo：invoke + CallbackHandler → Trace
│   └── evaluate.mjs          # ④ 离线评测：Dataset → Experiment（task + evaluators）→ Scores
├── docker-compose.yml        # 可选：自建 Langfuse 服务端（6 容器官方拓扑，项目代码不直接依赖它）
├── .env.example              # 环境变量示例
├── .gitignore                # 忽略 .env / node_modules / agent-workspace
└── package.json              # npm run demo / npm run eval
```

各文件的职责与关键点：

| 文件 | 是什么 | 关键点 |
| --- | --- | --- |
| `instrumentation.mjs` | 埋点基础设施（只做初始化，不产生业务行为） | 第一行 import；`exportMode: "immediate"`；导出 `shutdownTracing()` |
| `agent.mjs` | 纯业务 Agent，**不含任何 Langfuse 代码** | 观测 / 评测由调用方注入；换平台不用改它 |
| `index.mjs` | 观测入口 | `callbacks: [handler]` + `recursionLimit: 30` + `finally` 收尾 |
| `evaluate.mjs` | 评测入口 | Dataset upsert → `runExperiment` → item / run 双层打分 → 两处 flush |

## 前置依赖

1. **Node.js 18+**
   （仓库根目录提供 `node-fnm.ps1` / `node-npm.ps1` 包装脚本，走 fnm 管理的 Node，无需把 node 加进 PATH）
2. **一个 Langfuse 实例**，二选一：
   - **Langfuse Cloud**：注册后新建项目，拿 Public Key / Secret Key
   - **本地自建**：`docker compose up -d`（本目录的 `docker-compose.yml`），访问 `http://localhost:3000`
3. **兼容 OpenAI 协议的模型服务**（如阿里百炼），提供 `OPENAI_API_KEY`

## 环境配置

```bash
cp .env.example .env
```

`.env` 各项含义：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `LANGFUSE_PUBLIC_KEY` | 是 | Langfuse 项目公钥 `pk-lf-xxx` |
| `LANGFUSE_SECRET_KEY` | 是 | Langfuse 项目私钥 `sk-lf-xxx` |
| `LANGFUSE_BASE_URL` | 是 | Cloud 用 `https://cloud.langfuse.com`；自建用 `http://localhost:3000`。**唯一决定 trace 发往哪**，改完必须重启脚本（见「怎么确认走的是本地实例，而不是 Cloud」） |
| `OPENAI_API_KEY` | 是 | 模型服务 Key |
| `OPENAI_BASE_URL` | 否 | 兼容端点（Azure / 国内网关 / 本地代理），默认指向百炼兼容模式 |
| `OPENAI_MODEL` | 否 | 模型名，默认 `qwen-plus`（代码里兜底 `gpt-4o-mini`） |
| `LANGCHAIN_CALLBACKS_BACKGROUND` | 否 | 短生命周期脚本建议 `false`，确保 flush 前回调已写完 |
| `LANGFUSE_DATASET_NAME` | 否 | 评测 Dataset 名称，默认 `deepagents-eval` |

### 可选：本地自建 Langfuse（`docker-compose.yml`）

本目录的 `docker-compose.yml` 是 **Langfuse v3 官方 self-host 编排**，一条命令起 6 个容器：

| 服务 | 端口 | 作用 | 项目代码会直接连它吗 |
| --- | --- | --- | --- |
| `langfuse-web` | `3000` | 控制台 UI + 上报 API 入口 | **会**：`LANGFUSE_BASE_URL` 指向它 |
| `langfuse-worker` | `3030` | 异步消费队列，把事件写入 ClickHouse | 不会 |
| `postgres` | `5432` | **元数据**：组织 / 项目 / API Key / Dataset 定义 / Score 定义 | 不会 |
| `clickhouse` | `8123` / `9000` | **观测数据**：trace / observation / score（列存，量大） | 不会 |
| `redis` | `6379` | BullMQ 任务队列 + 缓存（web ↔ worker 的任务分发） | 不会 |
| `minio` | `9090` / `9091` | S3 兼容对象存储：事件、媒体文件、批量导出 | 不会 |

**关键澄清：6 个容器里只有 `langfuse-web` 是给项目用的，其余 5 个都是 Langfuse 自己的后端依赖。**

- 所以 `src/` 里搜不到 `redis` / `postgres` / `clickhouse` 是正常的 —— 项目只通过 HTTP 把 trace 发给 `langfuse-web:3000`，不直连任何数据库。
- v3 起 Langfuse 不再支持 SQLite 那种轻量单机模式：文件里的 `depends_on: ... condition: service_healthy` 已写明，postgres / clickhouse / redis / minio 全部健康后 web 与 worker 才会启动，**缺一不可**。
- 端口绑定也做了收敛：只有 `3000`（web）和 `9090`（minio）对外，其余全部绑 `127.0.0.1`，只能本机访问。
- 换句话说：用 **Langfuse Cloud** 时，这个文件完全不需要启动（Postgres/ClickHouse/Redis/MinIO 由云端托管）。

启动与配置：

```bash
docker compose up -d                   # 首次要拉 6 个镜像，耗时较长
docker compose ps                      # 等各服务变成 healthy
docker compose logs -f langfuse-web    # 需要时看服务端日志
```

启动后打开 `http://localhost:3000` → 注册账号 → 新建组织 / 项目 → 复制 `pk-lf-xxx` / `sk-lf-xxx` 填进 `.env`，
并把 `LANGFUSE_BASE_URL` 改成 `http://localhost:3000`。

> 也可以在 `.env` 里预设 `LANGFUSE_INIT_*`（组织 / 项目 / 用户 / Key），容器启动时自动建好项目，省掉手动注册。
> 注意 `docker compose` 与 Node 的 dotenv 读的是同一个 `.env` 文件，两边变量互不冲突，可以放在一起。

#### 怎么确认走的是本地实例，而不是 Cloud

`LANGFUSE_BASE_URL` 是**唯一**决定 trace 发往哪的开关：代码里显式把它传给 `LangfuseSpanProcessor`，除此之外没有任何地方决定上报地址。按下面几层依次确认：

1. **看启动日志（最快）**：脚本一跑就会先打印一行

   ```
   [langfuse] 上报目标: http://localhost:3000 → 本地自建实例
   ```

   打印成「远端 / Langfuse Cloud」就说明当前发的是云端。这行来自 `src/instrumentation.mjs`，取的就是 `.env` 里的值。

2. **改完 `.env` 必须重启脚本**：`dotenv` 只在进程启动时读一次 `.env`，改文件对已在运行的进程无效，要 Ctrl+C 后重新 `npm run demo` / `npm run eval`。

3. **看数据落在哪个 UI**：
   - 走本地：`http://localhost:3000` 的 Traces 里能搜到刚打印的 trace id，而 `https://cloud.langfuse.com` 的项目里搜不到；
   - 走云端：正好相反；
   - 两边都能搜到 → 多半是你先后改了 baseUrl 各跑过一次，别拿上一次的 trace 下结论（trace id 唯一，能对上才是这一次）。

4. **看服务端是否真的收到了**（自建时的确证）：`docker compose logs -f langfuse-web` 能看到 ingestion 相关请求。本地实例没起来时，SDK 导出会直接报连接错误 —— **不会**自动回退到云端，数据只会丢，不会串到云上。

5. **key 与实例是绑定的**：Cloud 的 key 用在自建实例（或反之）会直接 401 / 403，这是「连错实例」最典型的信号。

6. **网络层再确认一次**：跑脚本时看 node 进程的出站连接（任务管理器 → 资源监视器，或 `netstat -ano | findstr <node 的 PID>`）：连 `127.0.0.1:3000` 就是本地，连公网 `443` 就是 Cloud。

速查矩阵：

| `.env` 的 `LANGFUSE_BASE_URL` | 启动日志 | 结论 |
| --- | --- | --- |
| `http://localhost:3000` | `→ 本地自建实例` | 走本地（前提：容器确实在跑） |
| `https://cloud.langfuse.com` | `→ 远端 / Langfuse Cloud` | 走云端 |
| 未设置 | `(未设置，SDK 默认)` | SDK 兜底默认值，实际仍是云端 |

> 端口别看错：只有 `3000`（web）和 `9090`（minio）对外，其余（`3030` / `8123` / `9000` / `6379` / `5432` / `9091`）都绑在 `127.0.0.1`。
> 端口被占用时 `docker compose up` 会起不来，先释放端口，或用 `docker compose logs <service>` 定位是哪个服务。

## 运行

```bash
npm install

npm run demo    # 单次调用 + Trace（src/index.mjs）
npm run eval    # Dataset 评测 + Scores（src/evaluate.mjs）
```

---

## 第一部分：Trace 观测（`npm run demo`）

### 代码在做什么

```js
// src/index.mjs
import "./instrumentation.mjs"; // 必须第一个执行：先铺好 OTEL 管道，后面的调用才能被采集
import { CallbackHandler } from "@langfuse/langchain"; // LangChain ↔ Langfuse 的适配器
import { createAgent, extractReply } from "./agent.mjs"; // 与被评测脚本共用的 Agent 工厂
import { shutdownTracing } from "./instrumentation.mjs"; // 收尾：flush + 关闭 SDK
```

`index.mjs` 只有四步，每一步都对应一个容易漏的点：

| 步骤 | 代码 | 漏了会怎样 |
| --- | --- | --- |
| ① 铺管道 | 第一行 `import "./instrumentation.mjs"` | 没有 span 被采集，Langfuse 空白 |
| ② 造 Agent | `createAgent()` | —— |
| ③ 挂回调 | `new CallbackHandler({...})` + `callbacks: [handler]` | 管道通但无 span，同样空白 |
| ④ 收尾 | `.finally(() => shutdownTracing())` | trace 可能只有前半截，或完全没上报 |

### 故意设计成多步任务

demo 的问题不是一句话就能答完的：

```js
const QUERY =
  "查一下 Shanghai 和 Tokyo 的天气，再用计算器把两地气温数字相加（31+28），最后总结。";
```

它会让 Agent 走完 `查天气 → 查天气 → 相加 → 总结` 的完整 ReAct 循环，因此产出的 trace 里能看到：

- 多个 **Generation**（每轮模型推理各一条）串成时间线
- 每个 **tool span** 的确切入参 / 出参（`{"city":"Shanghai"}` → `"31°C，闷热多云"`）
- 谁快谁慢（工具几乎是 0ms，时间基本都在模型推理上）——这比只问一句「你好」更能体现 trace 的价值

### 控制台输出

跑完后控制台形如（内容是确定的，耗时取决于模型服务）：

```
[langfuse] 上报目标: https://cloud.langfuse.com → 远端 / Langfuse Cloud   ← instrumentation.mjs 启动时打印，最先输出
running: 查一下 Shanghai 和 Tokyo 的天气，再用计算器把两地气温数字相加（31+28），最后总结。

reply: 上海 31°C 闷热多云，东京 28°C 晴，两地气温相加为 59。

trace id: 8f3c1d2e...
```

`trace id` 就是 `handler.last_trace_id`，可直接在 Langfuse 顶部搜索框粘贴定位这次运行。

### 在 Langfuse 里看什么

| 视图 | 建议动作 |
| --- | --- |
| **Traces** | 按 tag `deepagents` 或 userId `local-dev` 过滤；点开任意一条看调用树与每段耗时 |
| **Sessions** | 找到 `deepagents-demo` 会话，多次 `npm run demo` 的运行会聚合在一起 |
| **单条 Trace 详情** | 看每轮 LLM 的 prompt / completion、工具的入参出参、整体 latency |
| **Trace 元数据** | `sessionId` / `userId` / `tags` 都在 `new CallbackHandler({...})` 里指定，是后续筛选与统计的抓手 |

---

## 第二部分：Dataset 评测（`npm run eval`）

### 执行流程

```
① 确保 Dataset 存在
   api.datasets.create({ name })           已存在则忽略（兼容 409 / conflict 文案）
   dataset.createItem({ id: "<dataset>:<item.id>", ... })   ← 固定 id = upsert，可反复运行
        │
② dataset.runExperiment({ name, runName, task, evaluators, runEvaluators, maxConcurrency })
        │
        ├─ 对每个 item 调用 task = runAgentTask(item)
        │     ├─ createAgent()                      每条用例一个干净实例，互不污染
        │     ├─ new CallbackHandler({...})         每条用例的调用链也进 Langfuse
        │     └─ invoke(..., { recursionLimit: 30 }) → extractReply(result)
        │
        ├─ item 级 evaluators：keywordHitEvaluator / nonEmptyEvaluator
        │     └─ 返回 { name, value, comment } → 变成该 item 的 Score
        │
        └─ run 级 runEvaluators：averageKeywordHit
              └─ 拿全部 itemResults 聚合出平均分

③ await langfuse.flush()     把 Dataset / Score 的异步上报刷完
   await shutdownTracing()    把 OTEL span 刷完并关闭 SDK
        │
④ Langfuse → Datasets → deepagents-eval → Runs 里对比
```

### 测试用例（种子 item）

用例定义在 `evaluate.mjs` 顶部的 `SEED_ITEMS`，**本地代码就是唯一事实来源**（每次运行 upsert 覆盖远端）：

| 用例 id | 输入 | 期望（`expectedOutput`） | 考察点 |
| --- | --- | --- | --- |
| `weather-shanghai` | 用工具查一下 Shanghai 的天气，直接告诉我结果。 | 命中 `31 / 上海 / shanghai / 闷热 / 多云` 中 ≥ 1 个 | 单次工具调用 + 中文复述 |
| `weather-tokyo` | 用工具查一下 Tokyo 的天气。 | 命中 `28 / 东京 / tokyo / 晴` 中 ≥ 1 个 | 单次工具调用 |
| `calculate-sum` | 用计算器把 31 和 28 相加，只告诉我结果。 | 命中 `59` ≥ 1 个 | 数值计算确实走工具，而非模型心算 |
| `weather-then-sum` | 查上海 + 东京天气，再相加（31+28），最后总结。 | 命中 7 个关键词中 ≥ 3 个 | 多步工具编排（端到端） |

两个设计取舍：

- **为什么以字符串数组 + `minHits` 作期望，而不是完整标准答案？**
  自然语言回复无法逐字比对，关键词 + 阈值（`minHits`）比「必须全中」更抗措辞漂移，又足以挡住跑偏的回答。
- **为什么用例 id 固定？**
  item id 拼成 `「<dataset>:<item.id>」` 后 upsert：本地改一条用例重跑，远端是**更新**而不是新增，Dataset 不会越跑越脏。

### 评测指标

| 层级 | 指标 | 返回值 | 含义 |
| --- | --- | --- | --- |
| Item | `keyword_hit` | 0 / 1 | 命中的关键词数 ≥ `minHits` 记 1；`comment` 记录「命中 2/5：31, shanghai」这类详情 |
| Item | `non_empty` | 0 / 1 | 回复去空格后长度 ≥ 4；用来单独暴露「模型啥也没答」的异常 |
| Run | `avg_keyword_hit` | 0 ~ 1 或 `null` | 全部用例 `keyword_hit` 的平均值；无有效分数时返回 `null`（UI 显示「无分数」而非误导性的 0） |

判定细节：

- 文本与关键词**都转小写**再比对，避免 `Shanghai` / `shanghai` 这种大小写差异造成假失败
- `non_empty` 是**兜底指标**：空回复往往意味着调用失败或提前终止，若不单列，会被 `keyword_hit=0` 掩盖成「只是没命中关键词」
- **为什么用确定性 evaluator 而不是 LLM-as-Judge？**
  本示例答案可枚举（31 / 28 / 59），关键词断言便宜、秒级、可复现、零额外依赖；
  开放式问答（摘要、写作、RAG 忠实度）才需要 LLM 打分。届时可换用 `@langfuse/client` 的
  `createEvaluatorFromAutoevals` 接入 autoevals，或自己写一个调用模型的 evaluator——**接口不变**，仍是返回 `{ name, value, comment }`。

### 结果解读

`npm run eval` 末尾会打印 `await result.format()`，形如一张「每条用例一行」的结果表：

```
3) experiment result:
<每条用例：input / output / expectedOutput + 各 evaluator 的分数与 comment>
```

同时所有分数会写入 Langfuse。在 **Datasets → deepagents-eval → Runs** 里：

- 每次运行是一条 Run（`runName` 为 `run-<ISO 时间戳>`，天然不重名）
- 同一 Run 内可下钻到单条 item，看到 output 与每条 Score 的 comment
- 不同 Run 之间可**并排对比**（这正是「换模型 / 改提示词后效果变好还是变差」的答案来源）
- 每条 item 的 trace 也在同一平台里，分数不理想时可直接点开看那一轮的完整调用链

> 换模型对比的实操：改 `.env` 的 `OPENAI_MODEL` → 再跑一次 `npm run eval` → 在 Runs 列表里对比两条 run 的 `avg_keyword_hit`。
> `metadata.model` 已随 Run 上报，筛选时能直接看出哪条 run 用的哪个模型。

---

## 技术要点

1. **两段式埋点，缺一不可**
   - `instrumentation.mjs`：注册 OTEL `TracerProvider` + `LangfuseSpanProcessor`，负责「**管道**」
   - `CallbackHandler`：LangChain 回调 → span，负责「**产物**」
   - 两者都到位才会在 Langfuse 看到 trace；只有其中一个 = 什么都不显示（且不报错，最难查）

2. **加载顺序是硬约束**
   `import "./instrumentation.mjs"` 必须是两个入口的**第一行**。OTEL 只能在库被 import 之前接管，晚注册会漏掉早期 span。

3. **短脚本必须自己收尾**
   - `exportMode: "immediate"`：span 一结束就尽快导出（默认 `batched` 适合长驻服务）
   - `shutdownTracing()`：`forceFlush()` 推完缓冲 + `sdk.shutdown()` 释放资源，写在 `main().finally(...)` 里，异常路径也执行
   - `langfuse.flush()`：刷的是 **管理 API**（Dataset / Score）的上报队列，与 OTEL 是两条独立通道，都要做

4. **关掉 LangChain 的后台回调**
   `.env` 中 `LANGCHAIN_CALLBACKS_BACKGROUND=false`。默认的「后台异步回调」在短脚本里可能来不及在 flush 前完成，导致偶发丢 trace。

5. **Agent 与观测 / 评测解耦**
   `agent.mjs` 里没有任何 Langfuse 代码；trace 由调用方挂 `callbacks`、评测由调用方建 Dataset。
   好处是换个可观测平台（如 LangSmith）只需改入口文件，Agent 本身不动。

6. **每次评测用全新 Agent 实例**
   `runAgentTask` 内 `createAgent()`：用例之间不共享对话状态，避免「上一条用例的上下文污染下一条」这种最隐蔽的评测失真。

7. **串行评测**
   `maxConcurrency: 1`：Agent 调用较重且要打 trace，串行时控制台输出可读、时间线干净；用例多了可以调大换吞吐。

8. **多步循环要有安全阀**
   `recursionLimit: 30`（LangGraph 默认值偏小）。工具循环轮数超限会抛 `GraphRecursionError`，多步任务建议显式放大。

9. **实例归属只由 `LANGFUSE_BASE_URL` 决定**
   `instrumentation.mjs` 把它显式传给 `LangfuseSpanProcessor`，并在启动时打印一行确认（`[langfuse] 上报目标: ...`）。
   切换实例 = 改这个变量 + 重启进程 + 换成对应实例的 key（Cloud 与自建的 key 不通用，错配直接 401 / 403）。

## 扩展示例

### 加一个工具

1. 在 `agent.mjs` 里用 `tool(实现, { name, description, schema })` 定义（description 是模型选工具的依据，写清「什么时候用」）
2. 加进 `createDeepAgent({ tools: [...] })` 数组
3. 在 `agent.mjs` 顶部 `systemPrompt` 里补一句「什么任务用这个工具」

### 加一条评测用例

在 `evaluate.mjs` 的 `SEED_ITEMS` 里追加一项（`id` 唯一、`expectedOutput.contains` 写可判定的关键词），重跑 `npm run eval` 即完成 upsert。

### 换成 LLM-as-Judge

把 `keywordHitEvaluator` 换成调用模型的 evaluator：仍返回 `{ name, value, comment }`，`value` 可以是 0~1 连续分。
若想省事，可用 `@langfuse/client` 的 `createEvaluatorFromAutoevals` 直接复用 autoevals 的成熟提示词（如 `AnswerRelevancy`、`Faithfulness`）。
注意：Judge 模型同样会消耗 token，且要接受其**自身的不确定性**——所以能确定性判定的场景优先用确定性 evaluator。

### 换成别的 Agent/LangChain 应用

只要能拿到「输入 → 输出」的可调用对象，就把它当作 `task`；trace 侧只要保证 `instrumentation` 先加载 + `invoke` 挂 `CallbackHandler` 即可。

## 常见问题

| 现象 | 排查方向 |
| --- | --- |
| Langfuse 里完全看不到 trace | ① `.env` 的 key / baseUrl 是否正确（自建必须写 `http://localhost:3000`）② 是否**第一行** import 了 `instrumentation.mjs` ③ 是否执行到 `shutdownTracing()` ④ `LANGCHAIN_CALLBACKS_BACKGROUND` 是否为 `false` |
| trace 只有前半截 | 进程提前退出 / 没 flush：确认 `finally` 里的 `shutdownTracing()` 真的执行了 |
| Dataset Run 没有分数 | 评测是否正常跑完；末尾 `await langfuse.flush()` 是否执行；evaluator 返回的 `value` 是否为数值（返回 `null` 会显示为「无分数」） |
| 用例越跑越多 / 改了用例没生效 | item id 是否固定（应为 `<dataset>:<item.id>`）；改了名等于新增一条 |
| 报 `GraphRecursionError` | 工具循环轮数超限，调大 `invoke` 的 `recursionLimit`（当前 30） |
| 报 401 / 403 | Key 与实例不匹配：Cloud 的 key 不能用于自建实例，反之亦然 |
| `docker compose up` 起不来 | 端口被占（见上表 3000/3030/8123/9000/9090/9091/6379/5432）；`docker compose logs <service>` 看具体服务 |
| 评测一条用例失败会不会中断整轮 | 不会，`runExperiment` 逐条隔离；但失败用例不会产生分数，看 Run 明细即可定位 |
| 分不清 trace 发到了本地还是云端 | 看启动日志的 `[langfuse] 上报目标:` 一行；对照「怎么确认走的是本地实例，而不是 Cloud」里的速查矩阵 |
| 改了 `.env` 的 `LANGFUSE_BASE_URL` 但没任何变化 | `dotenv` 只在进程启动时读一次：Ctrl+C 重启 `npm run demo` / `npm run eval` |
| 想把 trace 从云端切到自建（或反向） | 同时改 `LANGFUSE_BASE_URL` + `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`（两边 key 不通用），再重启脚本 |

## 依赖

| 包 | 作用 |
| --- | --- |
| `deepagents` | Deep Agent 工厂（`createDeepAgent`，在 LangChain `createAgent` 之上预置规划 / 工具循环） |
| `langchain` / `@langchain/core` / `@langchain/langgraph` | Agent 运行时、工具定义（`tool`）、图执行与 `recursionLimit` |
| `@langchain/openai` | OpenAI 兼容模型接入（配合 `OPENAI_BASE_URL` 指向百炼等网关） |
| `@langfuse/otel` | `LangfuseSpanProcessor`：把 OTEL span 导出到 Langfuse |
| `@langfuse/langchain` | `CallbackHandler`：LangChain 回调 → Langfuse span 的适配器 |
| `@langfuse/client` | `LangfuseClient`：Dataset / item / Score 等管理 API 与 `runExperiment` |
| `@langfuse/core` | 上述包的共享核心类型与工具 |
| `@opentelemetry/sdk-node` | Node 侧 OTEL SDK（`NodeSDK` 装配与 `shutdown`） |
| `zod` | 工具参数 Schema（转成 JSON Schema 发给模型） |
| `dotenv` | 加载 `.env` |
