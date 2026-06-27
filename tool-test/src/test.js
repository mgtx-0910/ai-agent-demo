import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

// 组装完整对话上下文
const messageList = [
  // 系统设定
  new SystemMessage("你是一个会调用计算器的助手"),
  // 用户提问
  new HumanMessage("帮我算 123 * 456"),
  // 工具运算后的结果回传
  new ToolMessage({
    tool_call_id: "xxx",
    content: "计算结果是 56088"
  })
];