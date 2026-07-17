/**
 * 流式 Tool Calls - 原始篇：直接读取 tool_call_chunks
 * 
 * 流式 Tool Calls 的最基础用法：不借助任何 parser，直接从 chunk.tool_call_chunks
 * 读取 args 字符串并实时打印。简单但无法做结构化处理。
 * 
 * @see stream-tool-calls-parser.mjs  — 升级版：使用 JsonOutputToolsParser 自动解析
 * @see tool-calls-args.mjs           — 非流式版：invoke 后直接取 args
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
    death_year: z.number().optional().describe("去世年份，如果还在世则不填"),
    nationality: z.string().describe("国籍"),
    fields: z.array(z.string()).describe("研究领域列表"),
    achievements: z.array(z.string()).describe("主要成就"),
    biography: z.string().describe("简短传记")
});

// 绑定工具到模型
const modelWithTool = model.bindTools([
    {
        name: "extract_scientist_info",
        description: "提取和结构化科学家的详细信息",
        schema: scientistSchema
    }
]);

console.log("🌊 流式 Tool Calls 演示 - 直接打印原始 tool_calls_chunk\n");

try {
    // 开启流式输出
    const stream = await modelWithTool.stream("详细介绍牛顿的生平和成就");

    console.log("📡 实时输出流式 tool_calls_chunk:\n");

    let chunkIndex = 0;

    for await (const chunk of stream) {
        chunkIndex++;
        // console.log(chunk);
        // 直接打印每个 chunk 的 tool_calls 信息
        if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
            process.stdout.write(chunk.tool_call_chunks[0].args || '');
        }
    }

    console.log("\n\n✅ 流式输出完成");

} catch (error) {
    console.error("\n❌ 错误:", error.message);
    console.error(error);
}
