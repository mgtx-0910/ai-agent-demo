/**
 * 流式输出 - 基础篇：无结构化
 * 
 * 演示 model.stream() 基础用法的普通流式输出，逐 chunk 接收文本内容。
 * 不做任何结构化解析，只是实时打印。
 * 
 * @see stream-structured-partial.mjs    — 升级版：流式 + 结构化解析
 * @see stream-with-structured-output.mjs — 对比：withStructuredOutput 流式
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';

const model = new ChatOpenAI({
    modelName: process.env.MODEL_NAME,
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0,
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
    },
});

const prompt = `详细介绍莫扎特的信息。`;

console.log("🌊 普通流式输出演示（无结构化）\n");

try {
    const stream = await model.stream(prompt);

    let fullContent = '';
    let chunkCount = 0;

    console.log("📡 接收流式数据:\n");

    for await (const chunk of stream) {
        chunkCount++;
        const content = chunk.content;
        fullContent += content;

        process.stdout.write(content); // 实时显示流式文本
    }

    console.log(`\n\n✅ 共接收 ${chunkCount} 个数据块\n`);
    console.log(`📝 完整内容长度: ${fullContent.length} 字符`);

} catch (error) {
    console.error("\n❌ 错误:", error.message);
}
