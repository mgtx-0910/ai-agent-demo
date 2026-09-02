# DeepAgents Test

基于 **LangChain `createAgent` + `createMiddleware` + [deepagents](https://www.npmjs.com/package/deepagents) 中间件体系**的 Agent 中间件能力演示：

- `deepagents` 官方扩展中间件：**文件系统（Filesystem）/ 长期记忆（Memory）/ 技能库（Skills）/ 子 Agent 委派（SubAgent）/ 自动摘要（Summarization）**
- LangChain 原生 `createMiddleware`：自定义生命周期钩子（beforeAgent / wrapModelCall / wrapToolCall / 短路拦截等）

每个 demo 是独立的 `node` 可运行脚本，用于对照理解"中间件如何扩展一个最小 Agent"。

## 项目结构

```
deepagents-test/
├── src/
│   ├── middleware-test.mjs          # 自定义 Middleware①：日志/注入上下文/敏感词短路（createMiddleware 基础）
│   ├── middleware-test2.mjs         # 自定义 Middleware②：中间件注册工具 + wrapToolCall 包装执行
│   └── deepagents/                  # deepagents 官方中间件五大 demo
│       ├── filesystem-agent.mjs     # ① Filesystem：虚拟文件系统 + 权限规则（读/写/越权拒绝）
│       ├── memory-agent.mjs         # ② Memory：项目级 + 用户级两级记忆（AGENTS.md / preferences.md）
│       ├── skills-agent.mjs         # ③ Skills：按需读取 SKILL.md 技能，画 excalidraw 流程图
│       ├── subagent-agent.mjs       # ④ SubAgent：主 Agent 委派 解题/讲题/出题 三个子 Agent
│       ├── summarization-agent.mjs  # ⑤ Summarization：超长会话自动滚动摘要 + 裁剪
│       └── workspace-memory/        # memory-agent 运行时产生的记忆文件（AGENTS.md 等）
│           └── workspace-summarization/  # summarization-agent 运行时产生的摘要文件
├── .env.example                     # 环境变量示例
└── package.json
```

> `workspace-*` 目录由对应脚本运行时自动生成/更新（filesystem-agent 每次运行会先清空重建），可随时删除，不参与版本管理逻辑。

## 前置依赖

1. **Node.js 18+**
2. **兼容 OpenAI 协议的模型服务**（如阿里百炼），由 `OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME` 指定
3. （可选）**LangSmith**：`.env` 中配置 `LANGCHAIN_*` 后可在 LangSmith 控制台观察每次 Agent 运行的完整链路

## 环境配置

复制 `.env.example` 为 `.env` 并填写：

```bash
# 模型服务（必填）
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen-plus
OPENAI_API_KEY=sk-xx

# LangSmith 追踪（可选）
LANGCHAIN_API_KEY=xx
LANGCHAIN_PROJECT=deepagents-test
LANGCHAIN_TRACING_V2=true
```

## 安装与运行

```bash
npm install
```

各 demo 独立运行：

```bash
# ① Filesystem —— 带权限的虚拟文件系统
node src/deepagents/filesystem-agent.mjs

# ② Memory —— 项目/用户两级长期记忆
node src/deepagents/memory-agent.mjs

# ③ Skills —— 技能库（需先安装 excalidraw 技能）
npx skills add github/awesome-copilot --skill excalidraw-diagram-generator -y
node src/deepagents/skills-agent.mjs

# ④ SubAgent —— 子 Agent 委派编排
node src/deepagents/subagent-agent.mjs

# ⑤ Summarization —— 会话自动摘要
node src/deepagents/summarization-agent.mjs

# 自定义 Middleware 实验
node src/middleware-test.mjs
node src/middleware-test2.mjs
```

## Demo 逐个说明

### ① filesystem-agent.mjs — Filesystem 中间件

给 Agent 一个"带权限的虚拟文件系统"：

- `FilesystemBackend` 把真实目录 `workspace/` 映射成虚拟根路径 `/`，`virtualMode` 让模型只能看见后端子目录内的世界
- `createFilesystemMiddleware` 自动注入 `ls / read_file / write_file / edit_file` 工具
- `permissions` 声明式规则：`先匹配先生效，未命中默认允许`

演示用例：

| 场景 | 行为 | 权限依据 |
| --- | --- | --- |
| 创建并编辑 `/todo.md` | 放行 | `write /todo.md → allow` |
| 读取 `/secret.txt` | 拒绝 | `read /secret.txt → deny` |
| 写入 `/hack.txt` | 拒绝 | `write /** → deny`（未显式放行） |

### ② memory-agent.mjs — Memory 中间件

两级长期记忆 + 读写闭环：

- **项目级记忆** `/AGENTS.md`：项目概览、技术栈、仓库约定
- **用户级记忆** `/memory/preferences.md`：语言、包管理器、回答风格等个人偏好
- `createMemoryMiddleware` 每轮把记忆文件注入 `<agent_memory>` 供模型参考
- "请记住…"由模型主动 `edit_file` 落盘，且提示词约束**按内容类型写入对应文件、不混写**

对话流程：空记忆提问 → 分别记住两条偏好/项目事实 → 跨轮复述，验证记忆闭环。

### ③ skills-agent.mjs — Skills 中间件

让 Agent 学会"用外部技能"：

- `createSkillsMiddleware` 把 `/.agents/skills/` 下的技能目录暴露给模型，模型按需 `read_file` 技能里的 `SKILL.md` 获得操作手册
- 与 `LocalShellBackend`（可执行真实 shell 命令）+ `createFilesystemMiddleware` 组合

演示结果：生成一张描述 skills-agent 工作流的 excalidraw 流程图（`src/deepagents/output/deepagents-skills-flow.excalidraw`），用 https://excalidraw.com 打开查看。

> 技能安装命令（首次）：`npx skills add github/awesome-copilot --skill excalidraw-diagram-generator -y`

### ④ subagent-agent.mjs — SubAgent 中间件

「1 个主 Agent + N 个专职子 Agent」的委派编排：

| 子 Agent | 职责 | 工具 |
| --- | --- | --- |
| `math-solver` | 列式计算应用题 | `calc`、`divide_evenly` |
| `kid-tutor` | 面向家长讲解解法 | （无工具） |
| `practice-maker` | 生成同类练习题 | `make_similar_problem` |

- 主 Agent 通过 `task` 工具按 `description` 选择子 Agent，自己不解题/不讲题/不出题
- 子 Agent 上下文靠主 Agent 的 tool call 参数（description）传递，例如 kid-tutor 拿到 solver 的完整解题过程
- `generalPurposeAgent: false` 表示只能委派给注册表内声明的子 Agent

### ⑤ summarization-agent.mjs — Summarization 中间件

解决"聊太多撑爆上下文"：

- 消息数达到 `trigger`（8 条）时，把最早的对话交给模型生成摘要并落盘到 `conversation_history/`
- 上下文裁剪到 `keep`（4 条），摘要继续参与后续对话，模型仍能回答"之前聊过什么"
- demo 用显式低阈值便于短会话内触发；生产环境可省略 `trigger/keep`，由中间件按模型上下文 profile 自动推断

### src/middleware-test.mjs / middleware-test2.mjs — 自定义 Middleware 基础

不依赖 deepagents，纯 LangChain `createMiddleware` 能力演示：

- **middleware-test.mjs**：`beforeAgent/afterAgent`、`beforeModel/afterModel`（统计模型调用次数）、`wrapModelCall`（改写请求注入 system 约束）、`beforeModel.canJumpTo("end")`（检测敏感词短路，跳过模型调用直接回复）
- **middleware-test2.mjs**：中间件通过 `tools` 字段注册工具（`get_current_time`）、`wrapToolCall` 包装工具执行（前置日志 + 改写 `ToolMessage`）、用 `Command.update` 把加工结果与计数器写回图状态

## 技术要点

- **一切皆中间件**：Agent 的最小形态是 `createAgent({ model, tools, systemPrompt })`，Filesystem/Memory/Skills/SubAgent/Summarization 都是围绕它的"可插拔中间件"，可自由组合
- **状态 schema 声明**：自定义中间件用 `stateSchema`（Zod）声明可读写的状态字段，钩子返回值/`Command.update` 会合并进图状态，`invoke` 返回值可直接读取
- **虚拟文件系统**：`FilesystemBackend(virtualMode)` 把真实目录映射为虚拟根 `/`，让模型在受控沙箱内操作文件，与真实进程/磁盘隔离
- **权限模型**：permissions 按 `先匹配先生效、未命中默认允许` 求值，可精确到 `操作 + 路径` 组合
- **记忆与摘要**：Memory 负责"结构化长期事实落盘 + 注入"，Summarization 负责"超长上下文压缩"，两者都是 filesystem 之上的一层约定

## 依赖

- `deepagents` — 官方中间件集合（Filesystem/Memory/Skills/SubAgent/Summarization 等）
- `langchain` / `@langchain/langgraph` — `createAgent` / `createMiddleware` / `Command` 基础框架
- `@langchain/openai` — OpenAI 兼容模型接入（演示用阿里百炼 qwen-plus）
- `zod` — 工具与中间件状态的参数 Schema
- `dotenv` — 环境变量加载
