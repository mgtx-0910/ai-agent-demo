/**
 * 预构建 Agent（createAgent）演示：
 * 用 langchain 的 createAgent 快速组装「模型 + 工具 + 提示词 + 检查点」，
 * Agent 会自动循环：模型决定调工具 -> 工具返回结果 -> 模型再组织回答。
 * 运行：node src/prebuilt-agent.mjs（需在 .env 配置模型相关变量）
 */
import "dotenv/config";

import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, tool } from "langchain";
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

// 模型：从 .env 读取模型名、Key 与 BaseURL（兼容国内中转服务）
const model = new ChatOpenAI({ 
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
  },
});

// createAgent 一键构建 Agent：绑定模型、工具、系统提示词，并用内存检查点保存会话
const agent = createAgent({
  model,
  tools: [getProductStock],
  systemPrompt:
    "你是仓库助手。问库存时必须调用 get_product_stock（模拟数据），禁止编造。",
  checkpointer: new MemorySaver(),
});

// 发起提问（带 thread_id，方便后续多轮对话延续上下文）
const result = await agent.invoke(
  { messages: [new HumanMessage("SKU-002 还剩多少库存？")] },
  { configurable: { thread_id: "demo-thread" } }
);

// 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
const drawable = await agent.graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyles: true });
console.log(mermaid);

// 取最后一条消息（通常是 Agent 的最终回答）
const last = result.messages.at(-1);
console.log(last?.content ?? result);
