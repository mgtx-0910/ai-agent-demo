# LangGraph Test

基于 **LangGraph**（`@langchain/langgraph`）的图编排能力沙盒，用 12 个独立脚本循序渐进演示「**状态图 → 条件路由 → 检查点 → Agent 工具循环 → 多智能体调度**」五个层次：

- **状态图基础**：`StateGraph` + `Annotation` 定义状态、节点串联与自环重试
- **条件路由**：`addConditionalEdges` 让流程按状态字段分流
- **检查点与中断**：`MemorySaver` / `SqliteSaver` 持久化会话，`interrupt()` 实现人工审批暂停点
- **Agent 工具循环**：`createAgent` 一键构建，或 `ToolNode` + `toolsCondition` 手写「模型 ↔ 工具」循环
- **多智能体**：`createSupervisor` 主管-下属模式，按问题自动分派子代理

> 定位：`agui-backend` 中 `createAgent` + `streamMode` 的底层能力验证场。主项目里用到的 LangGraph 机制（条件路由、检查点、工具循环）都能在这里找到最小可运行示例。

---

## 功能总览图

```
┌───────────────────────────── LangGraph Test ─────────────────────────────┐
│                                                                            │
│  ① 基础图           ② 路由/循环         ③ 检查点/中断      ④ Agent/多智能体  │
│                                                                           │
│  basic-graph       conditional-        checkpointer-      prebuilt-agent  │
│   · 线性串联节点     routing            memory             · createAgent   │
│                   · 按运算符分流        · thread_id 会话    prebuilt-       │
│  loop-retry                           · 状态跨轮累加      tool-node        │
│   · 条件边自环       trigger-error       checkpointer-      · ToolNode 循环 │
│   · 失败重试        · 节点内抛错         sqlite             multi-agent-    │
│                                       · 落盘可恢复        supervisor       │
│                                       graph-interrupt     · 主管-下属调度  │
│                                       · interrupt/resume                  │
│                                                                            │
│  辅助模块：simple-mock.mjs（天气/小知识）· inventory-mock.mjs（库存）        │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
langgraph-test/
├── .env.example                 # 环境变量示例（OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME）
├── package.json                 # 依赖：langgraph / openai / supervisor / better-sqlite3 等
└── src/
    ├── basic-graph.mjs          # ① 最小 StateGraph：1 状态字段 + 2 节点线性执行
    ├── conditional-routing.mjs  # ② 条件路由：query 含 +-*/ 走 math，否则走 chat
    ├── loop-retry.mjs           # ③ 条件边自环：前 2 次失败，第 3 次成功才到 END
    ├── trigger-error.mjs        # ④ 节点内故意抛错，验证错误能被子图调用方捕获
    ├── checkpointer-memory.mjs  # ⑤ MemorySaver：同一 thread_id 状态跨轮累加
    ├── checkpointer-sqlite.mjs  # ⑥ SqliteSaver：状态写入本地 sqlite，进程重启不丢
    ├── graph-interrupt.mjs      # ⑦ interrupt/resume：暂停等人工输入后恢复执行
    ├── prebuilt-agent.mjs       # ⑧ createAgent：模型+工具+提示词+检查点一键组装
    ├── prebuilt-tool-node.mjs   # ⑨ 手写 StateGraph + ToolNode + toolsCondition
    ├── multi-agent-supervisor.mjs#⑩ createSupervisor：主管分派天气/小知识子代理
    ├── simple-mock.mjs          # ⑪ 假接口：lookupWeather / lookupCityTrivia（供⑩用）
    └── inventory-mock.mjs       # ⑫ 假接口：getProductBySku 库存查询（供⑧⑨用）
```

---

## 快速开始

### 1. 环境要求

- Node.js 18+（建议使用仓库根目录 `.node-version` 指定的版本）
- ③④ 类脚本**无需**任何 API Key，直接可跑
- ⑧⑨⑩ 三个 Agent 脚本需要可访问的 OpenAI 兼容模型端点（`.env` 中配置）

### 2. 安装依赖

```bash
npm install
```

> Windows 下 `better-sqlite3`（⑥ 依赖）需要预编译二进制或本机编译工具链。若安装失败，可用镜像重试：
>
> ```bash
> npm install --registry=https://registry.npmmirror.com
> $env:npm_config_better_sqlite3_binary_host = "https://registry.npmmirror.com/-/binary/better-sqlite3"
> npm rebuild better-sqlite3
> ```

### 3. 配置环境变量

```bash
cp .env.example .env
```

| 变量 | 说明 | 示例 |
|---|---|---|
| `OPENAI_API_KEY` | AI 模型 API 密钥 | `sk-xxx` |
| `OPENAI_BASE_URL` | OpenAI 兼容端点地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `MODEL_NAME` | 模型名 | `qwen-plus` |

### 4. 运行脚本

```bash
node src/basic-graph.mjs               # ① 无需 Key
node src/conditional-routing.mjs       # ② 无需 Key
node src/loop-retry.mjs                # ③ 无需 Key
node src/checkpointer-memory.mjs       # ⑤ 无需 Key
node src/checkpointer-sqlite.mjs       # ⑥ 无需 Key（生成 src/checkpointer-demo.sqlite）
node src/trigger-error.mjs             # ④ 无需 Key，预期以退出码 1 结束
node src/graph-interrupt.mjs           # ⑦ 无需 Key，需在终端交互输入
node src/prebuilt-agent.mjs            # ⑧ 需 Key
node src/prebuilt-tool-node.mjs        # ⑨ 需 Key
node src/multi-agent-supervisor.mjs    # ⑩ 需 Key
```

每个脚本启动时都会先打印一张 **Mermaid 图**，可复制到 `https://mermaid.live` 或 Markdown 的 ` ```mermaid ` 代码块中可视化。

---

## 脚本说明

### ① 基础图 `src/basic-graph.mjs`

最小可运行的 `StateGraph`：定义 1 个状态字段 `text`，把 `step1 → step2` 两个节点线性串联：

```
START → step1 → step2 → END
```

- 状态字段用 `Annotation.Root` 声明，`reducer` 决定字段如何合并（此处"后写覆盖先写"），`default` 提供初始值
- 关键 API：`addNode` / `addEdge` / `compile` / `invoke`

### ② 条件路由 `src/conditional-routing.mjs`

在 `router` 节点根据 `query` 是否包含数学运算符（`+ - * /`），用 `addConditionalEdges` 分流：

```
START → router ──(含运算符)──▶ math → END
            └──(普通文本)──▶ chat → END
```

- 分流函数返回分支名，第三参数为「分支名 → 目标节点」的映射表
- `math` 分支用 `eval` 直接算表达式（**仅演示用**，生产环境切勿对用户输入执行 `eval`）

### ③ 循环重试 `src/loop-retry.mjs`

`attempt` 节点每轮把 `tries` +1，前 2 次失败、第 3 次成功；通过**条件边自环**实现重试：

```
START → attempt ──(失败)──▶ attempt（回到自身）
            └──(成功)──▶ END
```

### ④ 错误触发 `src/trigger-error.mjs`

`step_throw` 节点故意 `throw new Error(...)`，外层 `try/catch` 捕获后打印并设置 `process.exitCode = 1`。用于验证 LangSmith / 本地日志能否看到失败 run，以及异常如何向上传播。

### ⑤ 内存检查点 `src/checkpointer-memory.mjs`

`MemorySaver` 把每轮状态快照存在**进程内存**中。同一 `thread_id` 连续 `invoke`，`visitCount` 逐轮累加；不同 `thread_id` 相互隔离：

```
小张 thread_id=用户-小张：invoke×3 → visitCount 1 → 2 → 3
小李 thread_id=用户-小李：invoke×1 → visitCount 1
```

> 进程退出即丢失、重启归零——这是它与 ⑥ 的本质区别。

### ⑥ SQLite 检查点 `src/checkpointer-sqlite.mjs`

`SqliteSaver.fromConnString` 把状态快照写入本地 sqlite 文件（`src/checkpointer-demo.sqlite`），**进程重启后会话状态依然保留**：

```
MemorySaver  ──进程内──▶ 重启丢失
SqliteSaver  ──落盘──▶  重启可恢复（本脚本演示）
```

脚本启动时会先删除旧库文件，保证每次演示从 `visitCount = 0` 开始。

### ⑦ 中断 / 恢复 `src/graph-interrupt.mjs`

模拟「转账需人工确认」：图执行到 `waitConfirm` 节点时用 `interrupt()` 暂停，把待确认信息返回给调用方；调用方在终端输入后用 `new Command({ resume })` 交回，图从暂停点继续：

```
START → showTransfer → waitConfirm ──interrupt()──▶（暂停，等输入）
   ▲                                                │
   └────── resume（第二次 invoke，从暂停点续跑）────────┘ → END
```

- `interrupt` 必须配合 checkpointer（此处用 `MemorySaver`）保存暂停点
- 第二次 `invoke` 传入 `Command({ resume })`，`resume` 的值会写回状态字段 `userInput`

### ⑧ 预构建 Agent `src/prebuilt-agent.mjs`

`createAgent` 一键组装「模型 + 工具 + 系统提示词 + 检查点」，Agent 自动循环「调工具 → 收结果 → 再回答」：

```
用户提问 → 模型 ──tool_calls──▶ get_product_stock 工具 ──结果──▶ 模型 → 最终回答
                    ▲                                              │
                    └──────────────────────────────────────────────┘
```

- 工具用 `tool()` + `zod` schema 声明，内部调用 `inventory-mock.mjs` 的模拟数据
- 消息历史存于 `MemorySaver`，带 `thread_id` 即可多轮延续上下文

### ⑨ 手写工具循环 `src/prebuilt-tool-node.mjs`

不依赖 `createAgent`，手写 `StateGraph` 复现 Agent 循环：`agent` 节点调模型 → `toolsCondition` 判断返回里是否有 `tool_calls` → 有则进 `tools`（预置 `ToolNode` 自动执行并回填 `ToolMessage`）→ 回到 `agent`；没有则到 `END`：

```
START → agent ──(有 tool_calls)──▶ tools → agent（回到起点）
            └──(无 tool_calls)──▶ END
```

与 ⑧ 是同一机制的两种写法：⑧ 是开箱即用，⑨ 暴露了内部结构、方便插入自定义逻辑（如人工审核工具调用）。

### ⑩ 多智能体 Supervisor `src/multi-agent-supervisor.mjs`

`createSupervisor` 生成「主管-下属」工作流：主管 LLM 根据用户问题把任务分派给 `weather_agent` 或 `trivia_agent` 子代理，最后汇总回答：

```
用户问题 → supervisor（调度员）
              ├─ 问天气 ──▶ weather_agent ──lookup_weather──▶ 汇总
              └─ 问小知识 ─▶ trivia_agent ──lookup_city_trivia─▶ 汇总
```

- 子代理用 `createAgent` 构建，`description` 是主管做分派决策的依据
- 脚本用 `stream` + `streamMode: ["updates", "values"]` 同时采集**节点执行路径**（`updates`）与**最终状态**（`values`），直观展示主管实际调度了哪些节点

### ⑪⑫ 假接口模块 `src/simple-mock.mjs` / `src/inventory-mock.mjs`

非独立入口，仅被上述脚本导入：

| 模块 | 提供 | 被谁使用 |
|---|---|---|
| `simple-mock.mjs` | `lookupWeather(city)` / `lookupCityTrivia(city)` | ⑩ multi-agent-supervisor |
| `inventory-mock.mjs` | `getProductBySku(sku)` | ⑧ prebuilt-agent、⑨ prebuilt-tool-node |

---

## 核心概念速查

| 概念 | 说明 | 涉及脚本 |
|---|---|---|
| `StateGraph` | 图编排容器：节点 + 边 + 状态 Schema | 全部 |
| `Annotation` | 声明状态字段：`reducer` 定义合并规则，`default` 定义初始值 | ①②③⑤⑥⑦ |
| `addConditionalEdges` | 按状态字段返回的分支名动态选择下一节点 | ②③⑨ |
| Checkpointer | 保存每轮状态快照，支持 `thread_id` 会话隔离与断点续跑 | ⑤⑥⑦⑧ |
| `interrupt` / `Command.resume` | 暂停图等人工输入，再从中断点恢复 | ⑦ |
| ToolNode / toolsCondition | 预置工具执行节点与「是否需要调工具」判断 | ⑨ |
| `createAgent` | 一键构建完整 Agent（模型+工具+提示词+检查点） | ⑧⑩ |
| `createSupervisor` | 主管-下属多智能体工作流 | ⑩ |

---

## 测试说明

| 脚本 | 是否需要 API Key | 预期输出 |
|---|---|---|
| `basic-graph.mjs` | 否 | `{ text: "hello -> step1 -> step2" }` |
| `conditional-routing.mjs` | 否 | 文本走 chat 回显；`10 * 8` 走 math 得 `80` |
| `loop-retry.mjs` | 否 | `{ tries: 3, ok: true, message: "第 3 次成功" }` |
| `trigger-error.mjs` | 否 | 捕获 `DemoError`，退出码 1 |
| `checkpointer-memory.mjs` | 否 | 小张 1→2→3，小李 1 |
| `checkpointer-sqlite.mjs` | 否 | 同上，但状态写入 sqlite 文件 |
| `graph-interrupt.mjs` | 否 | 终端输入后输出最终结果 |
| `prebuilt-agent.mjs` | 是 | 按 SKU 查库存的回答 |
| `prebuilt-tool-node.mjs` | 是 | 同上（手写循环版） |
| `multi-agent-supervisor.mjs` | 是 | 天气+小知识汇总回答 + 调度路径 |

---

## 常见问题

- **`ERR_MODULE_NOT_FOUND`**：确认已执行 `npm install`；脚本为 ESM，`.mjs` 扩展名不受 `package.json` 的 `type: "commonjs"` 影响
- **`better-sqlite3` 安装失败**：该包需要预编译二进制，网络不畅时按「快速开始」里的镜像方式重试；若仍失败需本机安装 VS Build Tools + Python（node-gyp 编译链）
- **Agent 脚本 400 / `Arrearage` / `Access denied`**：检查 `.env` 的 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `MODEL_NAME` 是否与模型服务商匹配，以及账号是否欠费/该模型是否开通
- **`graph-interrupt.mjs` 卡住**：第一次 `invoke` 停在 `waitConfirm` 是**预期行为**，在终端输入内容回车后才会继续；直接回车则退出
- **`checkpointer-sqlite.mjs` 报 `db is locked`**：删除旧的 `src/checkpointer-demo.sqlite` 后重跑（脚本启动时会自动清理）
