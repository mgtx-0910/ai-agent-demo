/**
 * 结构化输出 - withStructuredOutput 篇（非流式）
 * 
 * model.withStructuredOutput(schema).invoke() 最简洁的结构化输出方式。
 * 返回值直接是解析好的对象（非文本），无需额外 parser 或手动 JSON.parse。
 * 
 * @see stream-with-structured-output.mjs — 流式版
 * @see tool-calls-args.mjs               — 对比：Tool Calls + args 方式
 * @see test/smart-import.mjs             — 实战应用：AI 提取 + 数据库写入
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

const model = new ChatOpenAI({
    modelName: process.env.MODEL_NAME,
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0,
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
    },
});

// 定义结构化输出的 schema
const scientistSchema = z.object({
    name: z.string().describe("科学家的全名"),
    birth_year: z.number().describe("出生年份"),
    nationality: z.string().describe("国籍"),
    fields: z.array(z.string()).describe("研究领域列表"),
});

// 使用 withStructuredOutput 方法
const structuredModel = model.withStructuredOutput(scientistSchema);

// 调用模型
const result = await structuredModel.invoke("介绍一下爱因斯坦");

console.log("结构化结果:", JSON.stringify(result, null, 2));
console.log(`\n姓名: ${result.name}`);
console.log(`出生年份: ${result.birth_year}`);
console.log(`国籍: ${result.nationality}`);
console.log(`研究领域: ${result.fields.join(', ')}`);
