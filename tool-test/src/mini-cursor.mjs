/**
 * mini-cursor.mjs — Mini-Cursor：LLM 驱动的自动化编码 Agent
 *
 * 功能：模拟 Cursor IDE 的核心能力——让 LLM 根据自然语言指令，
 *       自动读取文件、编写代码、执行命令、管理项目
 *
 * 工作流（ReAct 模式）：
 *   1. 用户提出任务需求（如"创建一个 React TodoList 应用"）
 *   2. Agent 思考 → 选择工具（执行命令/读写文件/列出目录）
 *   3. 工具执行并返回结果
 *   4. Agent 观察结果 → 继续思考 → 直到任务完成或达到最大迭代次数
 *
 * 依赖工具：all-tools.mjs 提供的 4 个工具
 *   - read_file：读取文件内容
 *   - write_file：创建/修改文件
 *   - execute_command：运行 shell 命令（npm、pnpm、node 等）
 *   - list_directory：浏览目录结构
 */

// 加载环境变量
import "dotenv/config";
// LLM 聊天模型
import { ChatOpenAI } from "@langchain/openai";
// 终端彩色输出
import chalk from "chalk";
// LangChain 消息类型
import {
  HumanMessage,
  SystemMessage,
  ToolMessage
} from "@langchain/core/messages";
// 从 all-tools.mjs 导入自定义工具
import {
  executeCommandTool,
  listDirectoryTool,
  readFileTool,
  writeFileTool
} from "./all-tools.mjs";

// ========== 1. 初始化模型 ==========
// temperature=0 让 Agent 行为更确定可预测（工程任务不需要随机性）
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME || "qwen-coder-turbo",
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  }
});

// ========== 2. 注册工具列表 ==========
const tools = [
  readFileTool,
  writeFileTool,
  executeCommandTool,
  listDirectoryTool
];

// 绑定工具到模型（让模型知道有哪些工具可用及各自的参数）
const modelWithTools = model.bindTools(tools);

// ========== 3. Agent 执行函数（ReAct 循环） ==========
async function runAgentWithTools(query, maxIterations = 30) {
  // SystemMessage 定义 Agent 的行为规范和工具说明
  const messages = [
    new SystemMessage(`你是一个项目管理助手，使用工具完成任务。

当前工作目录: ${process.cwd()}

工具：
1. read_file: 读取文件
2. write_file: 写入文件
3. execute_command: 执行命令（支持 workingDirectory 参数）
4. list_directory: 列出目录

重要规则 - execute_command：
- workingDirectory 参数会自动切换到指定目录
- 当使用 workingDirectory 时，绝对不要在 command 中使用 cd
- 错误示例: { command: "cd react-todo-app && pnpm install", workingDirectory: "react-todo-app" }
这是错误的！因为 workingDirectory 已经在 react-todo-app 目录了，再 cd react-todo-app 会找不到目录
- 正确示例: { command: "pnpm install", workingDirectory: "react-todo-app" }
这样就对了！workingDirectory 已经切换到 react-todo-app，直接执行命令即可

回复要简洁，只说做了什么`),
    new HumanMessage(query)
  ];

  // 循环：思考 → 工具调用 → 观察 → 继续思考
  for (let i = 0; i < maxIterations; i++) {
    console.log(chalk.bgGreen(`⏳ 工具调用次数: ${i + 1}, 允许调用的最大次数: ${maxIterations} 正在等待 AI 思考...`));
    const response = await modelWithTools.invoke(messages);
    messages.push(response); // 将模型回复加入历史

    // 没有工具调用 → 任务完成，返回最终答案
    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`\n✨ AI 最终回复:\n${response.content}\n`);
      return response.content;
    }

    // 执行每个工具调用，并将结果作为 ToolMessage 加入对话历史
    for (const toolCall of response.tool_calls) {
      const foundTool = tools.find((t) => t.name === toolCall.name);
      if (foundTool) {
        const toolResult = await foundTool.invoke(toolCall.args);
        messages.push(
          new ToolMessage({
            content: toolResult,
            tool_call_id: toolCall.id
          })
        );
      }
    }
  }

  return messages[messages.length - 1].content;
}

// ========== 4. 定义任务 — 创建 React TodoList 应用 ==========
const case1 = `创建一个功能丰富的 React TodoList 应用：

1. 创建项目： pnpm create vite react-todo-app --template react-ts
2. 修改 src/App.tsx，实现完整功能的 TodoList：
 - 添加、删除、编辑、标记完成
 - 分类筛选（全部/进行中/已完成）
 - 统计信息显示
 - localStorage 数据持久化
3. 添加复杂样式：
 - 渐变背景（蓝到紫）
 - 卡片阴影、圆角
 - 悬停效果
4. 添加动画：
 - 添加/删除时的过渡动画
 - 使用 CSS transitions
5. 列出目录确认

注意：使用 pnpm，功能要完整，样式要美观，要有动画效果

之后在 react-todo-app 项目中：
1. 使用 pnpm install 安装依赖
2. 使用 pnpm run dev 启动服务器
`;

// ========== 5. 启动 Agent ==========
try {
  await runAgentWithTools(case1);
} catch (error) {
  console.error(`\n❌ 错误: ${error.message}\n`);
}
