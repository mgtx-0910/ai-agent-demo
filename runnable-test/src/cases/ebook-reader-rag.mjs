/**
 * Runnable 实战 - 电子书 RAG 问答（RunnableSequence 构建 RAG 链路）
 * 
 * 完整 RAG 流程用 RunnableSequence 串联：Milvus 向量检索 →
 * 组装 {context, question} → prompt → model → StringOutputParser。
 * 使用 RunnableLambda 包装自定义逻辑（embedding + search + format），
 * 展示了如何将外部向量库操作融入 LCEL 管道。
 * 
 * @see ../runnables/RunnableLambda.mjs  — 基础：RunnableLambda 包装自定义函数
 */
import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { MilvusClient, MetricType } from "@zilliz/milvus2-sdk-node";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

const COLLECTION_NAME = "ebook_collection";
const VECTOR_DIM = 1024;

// 初始化 OpenAI Chat 模型
const model = new ChatOpenAI({
  temperature: 0.7,
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// 初始化 Embeddings 模型
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  dimensions: VECTOR_DIM,
});

// 初始化原生 Milvus 客户端
const milvusClient = new MilvusClient({
  address: "localhost:19530",
});

// 从 Milvus 中检索内容的 Runnable
const milvusSearch = new RunnableLambda({
  func: async (input) => {
    const { question, k = 5 } = input;

    try {
      // 1. 生成问题向量
      const queryVector = await embeddings.embedQuery(question);

      // 2. 调用 Milvus 搜索
      const searchResult = await milvusClient.search({
        collection_name: COLLECTION_NAME,
        vector: queryVector,
        limit: k,
        metric_type: MetricType.COSINE,
        output_fields: ["id", "book_id", "chapter_num", "index", "content"],
      });

      const results = searchResult.results ?? [];
      const retrievedContent = results.map((item, idx) => ({
        id: item.id,
        book_id: item.book_id,
        chapter_num: item.chapter_num,
        index: item.index ?? idx,
        content: item.content,
        score: item.score,
      }));

      return { question, retrievedContent };
    } catch (error) {
      console.error("检索内容时出错:", error.message);
      return { question, retrievedContent: [] };
    }
  },
});

// PromptTemplate：负责把 context / question 拼成最终 prompt
const promptTemplate = PromptTemplate.fromTemplate(
  `你是一个专业的《天龙八部》小说助手。基于小说内容回答问题，用准确、详细的语言。

请根据以下《天龙八部》小说片段内容回答问题：
{context}

用户问题: {question}

回答要求：
1. 如果片段中有相关信息，请结合小说内容给出详细、准确的回答
2. 可以综合多个片段的内容，提供完整的答案
3. 如果片段中没有相关信息，请如实告知用户
4. 回答要准确，符合小说的情节和人物设定
5. 可以引用原文内容来支持你的回答

AI 助手的回答:`
);

// 构建 context + 日志打印的 Runnable
const buildPromptInput = new RunnableLambda({
  func: async (input) => {
    const { question, retrievedContent } = input;

    if (!retrievedContent.length) {
      return {
        hasContext: false,
        question,
        context: "",
        retrievedContent,
      };
    }

    // 打印检索结果
    console.log("=".repeat(80));
    console.log(`问题: ${question}`);
    console.log("=".repeat(80));
    console.log("\n【检索相关内容】");

    retrievedContent.forEach((item, i) => {
      console.log(`\n[片段 ${i + 1}] 相似度: ${item.score ?? "N/A"}`);
      console.log(`书籍: ${item.book_id}`);
      console.log(`章节: 第 ${item.chapter_num} 章`);
      console.log(`片段索引: ${item.index}`);
      const content = item.content ?? "";
      console.log(
        `内容: ${content.substring(0, 200)}${
          content.length > 200 ? "..." : ""
        }`
      );
    });

    const context = retrievedContent
      .map((item, i) => {
        return `[片段 ${i + 1}]
章节: 第 ${item.chapter_num} 章
内容: ${item.content}`;
      })
      .join("\n\n━━━━━\n\n");

    return {
      hasContext: true,
      question,
      context,
      retrievedContent,
    };
  },
});

// 数据流向：{question, k} → 向量检索 → 格式化上下文 → 过滤空结果 → 拼 prompt → LLM → 纯文本回答
const ragChain = RunnableSequence.from([
  milvusSearch,     // 1. 向量检索：question → embeddings → Milvus 搜索 → {question, retrievedContent}
  buildPromptInput, // 2. 构建 Prompt 输入：格式化检索结果 → {hasContext, question, context, retrievedContent}
  new RunnableLambda({
    func: async (input) => {
      const { hasContext, question, context } = input;

      if (!hasContext) {
        // 未检索到内容时返回兜底文案，跳过后续 prompt/model 步骤
        const fallback =
          "抱歉，我没有找到相关的《天龙八部》内容。请尝试换一个问题。";
        console.log(fallback);
        return { question, context: "", answer: fallback, noContext: true };
      }

      // 有检索结果时，向 PromptTemplate 提供 { question, context }
      return { question, context, noContext: false };
    },
  }),
  promptTemplate,   // 3. 填充 prompt：{question, context} → 完整的系统 prompt
  model,            // 4. 调用 LLM：prompt → AIMessage
  new StringOutputParser(), // 5. 提取纯文本：AIMessage → 最终回答字符串
]);


async function initMilvusCollection() {
  console.log("连接到 Milvus...");
  await milvusClient.connectPromise;
  console.log("✓ 已连接\n");

  try {
    await milvusClient.loadCollection({ collection_name: COLLECTION_NAME });
    console.log("✓ 集合已加载\n");
  } catch (error) {
    if (!error.message.includes("already loaded")) {
      throw error;
    }
    console.log("✓ 集合已处于加载状态\n");
  }
}

async function main() {
  try {
    await initMilvusCollection();

    const input = {
      question: "鸠摩智会什么武功？",
      k: 5,
    };

    console.log("=".repeat(80));
    console.log(`问题: ${input.question}`);
    console.log("=".repeat(80));
    console.log("\n【AI 流式回答】\n");

    const stream = await ragChain.stream(input);

    for await (const chunk of stream) {
      process.stdout.write(chunk);
    }

    console.log("\n");
  } catch (error) {
    console.error("错误:", error.message);
  }
}

await main();

