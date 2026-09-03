// ============================================================================
// src/max-input-tokens-test.mjs — maxInputTokens 覆写实验脚本
//
// 目的：验证能否通过 Object.defineProperty 覆写 ChatOpenAI 实例的
// profile.maxInputTokens。部分模型网关（如 DashScope 兼容模式）可能
// 不提供该字段，可通过此方式强制声明上下文输入上限。
//
// 运行：node src/max-input-tokens-test.mjs
// 预期输出：先打印模型默认值，再打印覆写后的 1024
// ============================================================================
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
    model: process.env.OPENAI_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL
    }
});

// 打印默认的 maxInputTokens（若模型接口不支持可能为 undefined）
console.log(model.profile.maxInputTokens);

// 用 defineProperty 强制覆写 profile.maxInputTokens
Object.defineProperty(model, "profile", {
  get: () => ({ maxInputTokens: 1_024 }),
});

// 打印覆写后的值，验证覆写是否生效
console.log(model.profile.maxInputTokens);
