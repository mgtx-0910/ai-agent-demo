/**
 * 结构化输出 - fromNamesAndDescriptions 篇
 * 
 * StructuredOutputParser.fromNamesAndDescriptions 最简方式：
 * 用 key: 描述 的键值对定义字段，parser 自动生成格式化指令和解析。
 * 适合简单结构，不需要 Zod。
 * 
 * @see structured-output-parser2.mjs  — 升级版：fromZodSchema 复杂结构 + 验证
 * @see json-output-parser.mjs         — 同级：JsonOutputParser JSON 解析
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { StructuredOutputParser } from '@langchain/core/output_parsers';

// 初始化模型
const model = new ChatOpenAI({
    modelName: process.env.MODEL_NAME,
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0,
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
    },
});

// 定义输出结构
const parser = StructuredOutputParser.fromNamesAndDescriptions({
    name: "姓名",
    birth_year: "出生年份",
    nationality: "国籍",
    major_achievements: "主要成就，用逗号分隔的字符串",
    famous_theory: "著名理论"
});

const question = `请介绍一下爱因斯坦的信息。

${parser.getFormatInstructions()}`;

console.log('question:', question)

try {
    console.log("🤔 正在调用大模型（使用 StructuredOutputParser）...\n");

    const response = await model.invoke(question);

    console.log("📤 模型原始响应:\n");
    console.log(response.content);

    const result = await parser.parse(response.content);

    console.log("\n✅ StructuredOutputParser 自动解析的结果:\n");
    console.log(result);
    console.log(`姓名: ${result.name}`);
    console.log(`出生年份: ${result.birth_year}`);
    console.log(`国籍: ${result.nationality}`);
    console.log(`著名理论: ${result.famous_theory}`);
    console.log(`主要成就: ${result.major_achievements}`);

} catch (error) {
    console.error("❌ 错误:", error.message);
}
