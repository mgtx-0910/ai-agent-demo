# AGUI Frontend

基于 **React 19 + TypeScript + Vite + Vercel AI SDK** 的 AI 智能体对话前端，配套后端 `agui-backend`，实现「流式对话 + 工具调用可视化」的完整 Agent 交互体验。

## 功能特性

- **流式对话**：通过 `@ai-sdk/react` 的 `useChat` + `DefaultChatTransport` 对接后端 `POST /ai/chat`（SSE），打字机效果逐字渲染
- **工具调用可视化**：当 Agent 调用 `web_search`（联网搜索）、`send_mail`（发送邮件）工具时，以结构化卡片实时展示工具参数生成、执行进度与结果
- **富文本渲染**：基于 Streamdown 流式渲染 Markdown，支持代码高亮与 Mermaid 图表
- **多轮上下文**：历史消息由 `useChat` 自动维护，随每次请求一并发送

## 目录结构

```
agui-frontend/
├── src/
│   ├── main.tsx                    # React 应用入口
│   ├── App.tsx                     # 主聊天界面（消息气泡 + 输入框 + 状态控制）
│   ├── components/
│   │   ├── ToolPanels.tsx          # 工具调用结果面板（web_search / send_mail）
│   │   ├── ToolPanels.css
│   │   ├── StreamdownText.tsx      # 流式 Markdown / 代码 / Mermaid 渲染
│   │   └── StreamdownText.css
│   ├── App.css
│   └── index.css
├── index.html
├── vite.config.ts                  # Vite 配置
└── package.json
```

## 快速开始

### 1. 环境要求

- Node.js 18+
- 后端 `agui-backend` 已启动（默认 `http://localhost:3000`）

### 2. 安装与启动

```bash
npm install
npm run dev
```

默认运行在 `http://localhost:5173`。

> 后端地址在 `src/App.tsx` 顶部的 `API_BASE` 常量中配置，默认指向 `http://localhost:3000`，与本地 `agui-backend` 一致。

### 3. 使用

在输入框输入问题，Enter 发送，Shift+Enter 换行。对话过程中：

- 助手回答逐字流式显示
- 涉及最新信息时触发 `web_search` 工具面板
- 请求发送邮件时触发 `send_mail` 工具面板

## 其他命令

```bash
npm run build    # 类型检查 + 生产构建（输出到 dist/）
npm run preview  # 本地预览构建产物
npm run lint     # ESLint 检查
```
