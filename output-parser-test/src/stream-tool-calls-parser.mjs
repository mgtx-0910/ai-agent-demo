/**
 * 流式 Tool Calls - 解析篇：JsonOutputToolsParser
 * 
 * 流式 Tool Calls 场景，使用 JsonOutputToolsParser 增量解析 tool_calls 的 JSON 参数。
 * 相比 raw 方式直接打印 chunk，parser 能解析完整的 args 对象做增量显示。
 * 
 * ══ bindTools 只声明 schema vs tool() 声明函数体 ══
 * 这里 bindTools 只传了 name/description/schema，没有传函数体：
 *   model.bindTools([{ name, description, schema }])
 * 适用场景：只需模型按格式输出结构化数据，你手动读取 args 即可，
 *         不需要真实执行操作（如调用 API、读写文件）。
 * 
 * 对比 test/all-tools.mjs 中的 tool() 工厂函数：
 *   const readFileTool = tool(函数体, { name, description, schema })
 * 适用场景：模型调工具后需要真实执行操作，
 *         通过 foundTool.invoke(args) 触发函数执行。
 * 
 * @see stream-tool-calls-raw.mjs     — 对比：原始方式直接读 tool_call_chunks
 * @see tool-calls-args.mjs           — 非流式版：通过 args 获取结构化结果
 * @see test/all-tools.mjs            — 对比：tool() 定义带函数体的工具
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { JsonOutputToolsParser } from '@langchain/core/output_parsers/openai_tools';
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

// 1. 绑定工具并挂载解析器
const parser = new JsonOutputToolsParser();
const chain = modelWithTool.pipe(parser);

try {
    // 2. 开启流
    const stream = await chain.stream("详细介绍牛顿的生平和成就");

    let lastContent = ""; // 记录已打印的完整内容
    let finalResult = null; // 存储最终的完整结果

    console.log("📡 实时输出流式内容:\n");

    for await (const chunk of stream) {
        // console.log(chunk);

        if (chunk.length > 0) {
            const toolCall = chunk[0];

            // 获取当前工具调用的完整参数内容
            // ⚠️ JsonOutputToolsParser 流式返回的每个 chunk 中，args 都是"当前累积的完整快照"而非增量
            //    第1个 chunk: { name: "牛顿" }
            //    第2个 chunk: { name: "牛顿", birth_year: 1643 }
            //    第3个 chunk: { name: "牛顿", birth_year: 1643, nationality: "英国" }
            //    如果直接 console.log(toolCall.args)，每次都会打印完整对象，看起来像不断重复
            //    所以必须用长度对比的方式，只提取新增部分做增量输出
            const currentContent = JSON.stringify(toolCall.args || {}, null, 2);

            if (currentContent.length > lastContent.length) {
                const newText = currentContent.slice(lastContent.length);
                process.stdout.write(newText); // 实时输出到控制台
                lastContent = currentContent; // 更新已读进度
            }

            console.log(toolCall.args);
        }
    }

    console.log("\n\n✅ 流式输出完成");

} catch (error) {
    console.error("\n❌ 错误:", error.message);
    console.error(error);
}