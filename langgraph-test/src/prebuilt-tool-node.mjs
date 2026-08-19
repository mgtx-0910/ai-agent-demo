/**
 * 预置工具节点（ToolNode + toolsCondition）演示：
 * 不用 createAgent，而是手写 StateGraph：
 *   agent 节点让模型决定是否调工具 -> toolsCondition 判断返回的 tool_calls
 *   -> 有则进入 tools 节点执行工具，结果回填后回到 agent；没有则直接 END。
 * 运行：node src/prebuilt-tool-node.mjs（需在 .env 配置模型相关变量）
 */
import "dotenv/config";

import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { getProductBySku } from "./inventory-mock.mjs";

// 注册工具：按 SKU 查商品库存（内部走 inventory-mock.mjs 的模拟数据）
const getProductStock = tool(
  async ({ sku }) => getProductBySku(sku),
  {
    name: "get_product_stock",
    description:
      "按 SKU 查商品名与库存，SKU 如 SKU-001。",
    schema: z.object({
      sku: z.string().describe("商品 SKU"),
    }),
  }
);

const tools = [getProductStock];

// 模型绑定工具：模型输出里才会出现 tool_calls
const llm = new ChatOpenAI({ 
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
  },
}).bindTools(tools);

// agent 节点：把整个消息历史交给模型，返回模型的新消息
async function agent(state) {
  const response = await llm.invoke(state.messages);
  return { messages: response };
}

// 预置工具节点：自动执行消息里的 tool_calls，并把结果作为 ToolMessage 回填
const toolNode = new ToolNode(tools);

// 构图：START -> agent；agent 后按 toolsCondition 判断：
//   模型要求调工具 -> 进 tools；否则 -> 到 END；tools 执行完回到 agent
const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", agent)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", toolsCondition, ["tools", END])
  .addEdge("tools", "agent")
  .compile();

// 发起提问，走完整的「模型 <-> 工具」循环
const result = await graph.invoke({
  messages: [
    new HumanMessage(
      "查一下 SKU-001 的库存还有多少，回答里带上商品名和数字。"
    ),
  ],
});

// 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
const drawable = await graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyles: true });
console.log(mermaid);

// 取最后一条消息（通常是 Agent 的最终回答）
const last = result.messages.at(-1);
console.log(last?.content ?? result.messages);
