/**
 * Runnable 对比篇 - 没有 Runnable 的写法（对照版）
 * 
 * 手动分步调用 promptTemplate.format() → model.invoke() → outputParser.invoke()，
 * 每步需显式传参并 await。对比 runnable.mjs 可以看出 RunnableSequence 省掉了所有中间变量。
 * 
 * @see runnable.mjs — 对照版：RunnableSequence 一行 chain.invoke() 替代三步手动调用
 */
import 'dotenv/config';
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

const model = new ChatOpenAI({
    modelName: process.env.MODEL_NAME,      // 从环境变量读取模型名称
    apiKey: process.env.OPENAI_API_KEY,     // OpenAI API Key
    temperature: 0,                         // 固定输出（翻译场景不需要随机性）
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL,  // 兼容代理端点
    },
});

// 定义输出结构 schema：翻译文本 + 3 个关键词
const schema = z.object({
    translation: z.string().describe("翻译后的英文文本"),
    keywords: z.array(z.string()).length(3).describe("3个关键词")
});

const outputParser = StructuredOutputParser.fromZodSchema(schema);

const promptTemplate = PromptTemplate.fromTemplate(
    '将以下文本翻译成英文，然后总结为3个关键词。\n\n文本：{text}\n\n{format_instructions}'
);

const input = { 
    text: 'LangChain 是一个强大的 AI 应用开发框架',
    format_instructions: outputParser.getFormatInstructions()
};

// 手动三步调用：每步需显式传参并 await，步骤之间通过变量手动串联
// 步骤 1: 格式化 prompt（将 {text, format_instructions} 填入模板）
const formattedPrompt = await promptTemplate.format(input);
// 步骤 2: 调用模型（将格式化后的 prompt 传给 LLM）
const response = await model.invoke(formattedPrompt);
// 步骤 3: 解析输出（将 AIMessage 解析为 { translation, keywords } 结构化对象）
const result = await outputParser.invoke(response);
console.log('✅ 最终结果:');
console.log(result);
