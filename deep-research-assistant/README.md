# 深度调研助手（Deep Research Assistant）

综合 DeepAgents 能力的实战示例：任务规划、文件系统、分层子 Agent、Skills、长期记忆、REPL 数据分析、流式进度。**默认全中文输出。**

## 能力覆盖

| DeepAgents 能力 | 在本项目中的用途 |
|----------------|-----------------|
| `write_todos` | 拆解调研任务、跟踪进度（中文待办） |
| 文件系统 | `workspace/sources/` 存原始资料，`workspace/reports/` 存报告 |
| 子 Agent | researcher（调研员）、editor（编辑）、analyst（分析师） |
| Skills | `web-research`、`report-writer` 按需加载 |
| Memory | `AGENTS.md` 加载中文报告偏好 |
| REPL | analyst 子 Agent 用 QuickJS 做数值计算 |
| Streaming | CLI 实时输出各 Agent 执行步骤 |

## 架构

```
主 Agent（深度调研助手）
  ├── 技能: web-research / report-writer
  ├── 记忆: AGENTS.md
  ├── 子 Agent: researcher  → 联网搜索（web_search，最多 3 次搜索）
  ├── 子 Agent: editor      → 审稿（只反馈不改稿）
  └── 子 Agent: analyst     → QuickJS eval REPL（数值计算）
```

## 快速开始

在本目录下独立安装依赖并运行：

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY（必填）、BOCHA_API_KEY（必填）

# 运行
pnpm start "调研 2026 年 AI Agent 框架对比：LangGraph、DeepAgents、AutoGen"

# 交互式输入主题
pnpm start
```

## 查看产出

- 报告：`workspace/reports/`
- 原始资料：`workspace/sources/`

运行结束后 CLI 会自动列出本次新增的 sources / reports 文件。

## 典型工作流

1. 主 Agent 用 `write_todos` 规划任务（中文待办）
2. 按 `web-research` 技能写 `research_plan.md`，并行启动调研员
3. 若有数值分析需求，委派 analyst
4. 综合 findings 写草稿报告
5. editor 审稿 → 修订 → 保存终稿

## 测试脚本

仓库内置两个独立验证脚本（均读取 `.env` 配置）：

| 脚本 | 作用 | 运行 |
|------|------|------|
| `src/todo-middleware-test.mjs` | 验证 `todoListMiddleware`：模型收到多步任务时生成中文 todo 列表 | `node src/todo-middleware-test.mjs` |
| `src/max-input-tokens-test.mjs` | 验证用 `Object.defineProperty` 覆写 `profile.maxInputTokens`（部分网关不支持该字段时的兜底方案） | `node src/max-input-tokens-test.mjs` |

> `src/agent.mjs` 中被注释掉的 `Object.defineProperty(...)` 即对应上述实验在生产 Agent 中的用法。

## 项目结构

```
deep-research-assistant/
  AGENTS.md                # 长期记忆（中文报告偏好）
  .env.example             # 环境变量示例
  src/
    agent.mjs              # Agent 工厂：主 Agent + 3 个子 Agent 的定义与组装
    cli.mjs                # CLI 入口：流式执行、实时日志、产出文件展示
    tools/
      search.mjs           # Bocha 联网搜索工具（web_search）
    todo-middleware-test.mjs   # todoListMiddleware 行为验证
    max-input-tokens-test.mjs  # maxInputTokens 覆写实验
  skills/
    web-research/SKILL.md  # 联网调研流程技能
    report-writer/SKILL.md # 报告撰写规范技能
  workspace/               # 运行产物（git 忽略）
    sources/               # 调研计划、question.txt、findings_*.md、analysis_*.md
    reports/               # draft_*.md（草稿）与 report_*.md（终稿）
```

## 代码导读

| 文件 | 关键点 |
|------|--------|
| `src/tools/search.mjs` | 封装 Bocha API；所有失败场景返回中文错误串而非抛异常，方便模型自行决策 |
| `src/agent.mjs` | `FilesystemBackend(virtualMode)` 虚拟文件系统；`memory` 加载 `AGENTS.md`；`skills: ["/skills/"]`；researcher 仅挂 `webSearch` 工具；analyst 注入 `createCodeInterpreterMiddleware` |
| `src/cli.mjs` | `streamMode: "updates"` + `subgraphs: true` 流式子图执行；通过 `model_request` / `tools` 节点预登记并展示文件路径与 eval 代码 |

## 自定义

- **报告偏好**：编辑 `AGENTS.md`
- **调研流程**：编辑 `skills/web-research/SKILL.md`
- **报告模板**：编辑 `skills/report-writer/SKILL.md`
- **子 Agent 行为**：编辑 `src/agent.mjs` 中的 system prompt

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | OpenAI（或兼容 API）密钥 |
| `OPENAI_BASE_URL` | 否 | 自定义 API 地址（如 DashScope 兼容模式） |
| `OPENAI_MODEL` | 否 | 模型名，默认 `gpt-4o` |
| `BOCHA_API_KEY` | 是 | Bocha 搜索密钥 |
| `RECURSION_LIMIT` | 否 | 递归上限，默认 `300` |
| `LANGCHAIN_API_KEY` | 否 | LangSmith 链路上报密钥 |
| `LANGCHAIN_PROJECT` | 否 | LangSmith 项目名 |
| `LANGCHAIN_TRACING_V2` | 否 | 开启 LangSmith 追踪（`true`） |

`.env` 示例：

```env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_MODEL=qwen-plus
BOCHA_API_KEY=你的_bocha_key
RECURSION_LIMIT=500
```
