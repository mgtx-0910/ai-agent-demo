/**
 * Runnable 入门篇 - RunnableSequence 串联 prompt → model → parser
 * 
 * RunnableSequence.from([A, B, C]) 把三个步骤串成流水线，数据自动流转：
 *   input → promptTemplate.format() → model.invoke() → outputParser.invoke() → 最终结果
 * 等效于 .pipe() 链式写法：promptTemplate.pipe(model).pipe(outputParser)
 * 
 * @see before.mjs — 对照版：没有 Runnable 的手动三步调用
 */
import 'dotenv/config';
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { RunnableSequence } from "@langchain/core/runnables";
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

// 等效的 .pipe() 链式写法：
// const chain = promptTemplate.pipe(model).pipe(outputParser);

// 数据流向：input {text, format_instructions} → promptTemplate 拼接 prompt → model 调用 LLM → outputParser 解析为对象
const chain = RunnableSequence.from([
    promptTemplate,     // 1. 将 {text, format_instructions} 拼成完整 prompt
    model,              // 2. 调用 LLM，输出 AIMessage
    outputParser        // 3. 解析 LLM 输出为 { translation, keywords } 结构化对象
]);

const input = { 
    text: 'LangChain 是一个强大的 AI 应用开发框架',
    format_instructions: outputParser.getFormatInstructions()
};

// 执行 chain，数据自动沿 [promptTemplate → model → outputParser] 流转
const result = await chain.invoke(input);

console.log('✅ 最终结果:');
console.log(result);
