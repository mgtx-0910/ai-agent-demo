/**
 * ============================================================
 * naive-rag.mjs —— 朴素 RAG（Retrieval-Augmented Generation）
 * ============================================================
 * 最基础的 RAG 流程演示：检索（retrieve）→ 生成（generate），两条边直线走完，
 * 没有路由、没有评估、没有联网回退，是理解 RAG 的起点。
 *
 * 图结构：
 *   START --> retrieve --> generate --> END
 *
 * 数据源：Milvus 向量数据库中的 ebook_collection 集合（《天龙八部》分章切块后的向量）。
 * 依赖：本地需先启动 Milvus（默认 localhost:19530），并在 .env 配置
 *   OPENAI_API_KEY / OPENAI_BASE_URL（兼容 OpenAI 协议的模型网关）。
 *
 * 运行：node src/naive-rag.mjs
 */
import "dotenv/config"; // 启动时自动加载 .env 中的环境变量
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Milvus } from "@langchain/community/vectorstores/milvus";

// ===== 可调参数 =====
const COLLECTION_NAME = "ebook_collection"; // Milvus 中的集合名（存放分章切块的向量）
const TOP_K = 5; // 每次向量检索默认返回的相似片段条数

/**
 * 图的状态定义（StateGraph 的共享内存）：
 * 每个节点读入 state 字段、返回要更新的字段，框架自动合并成新的 state。
 * 这里字段用 Annotation 声明，未自定义 reducer 时默认「后写覆盖先写」。
 *   question   : 用户问题
 *   k          : 检索条数
 *   documents  : 检索命中的文档片段列表（带相似度分数和元数据）
 *   generation : 最终生成的回答文本
 */
const GraphState = Annotation.Root({
    question: Annotation,
    k: Annotation,
    documents: Annotation,
    generation: Annotation,
});

// 生成模型：temperature=0 保证回答更确定（RAG 场景希望严格基于检索内容）
const model = new ChatOpenAI({
    temperature: 0,
    model: "qwen-plus",
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL, // 自定义网关（阿里百炼 / DeepSeek 等兼容 OpenAI 协议的服务）
    },
    apiKey: process.env.OPENAI_API_KEY,
});

// 嵌入模型：把文本转成向量，需与入库时使用同一模型/维度，否则检索无效
const embeddings = new OpenAIEmbeddings({
    model: "text-embedding-v3",
    dimensions: 1024, // 必须与 Milvus 建集合时的向量维度一致
});

// 全局向量库句柄：main() 中连接 Milvus 后赋值，各节点复用
let vectorStore;

/**
 * 核心检索函数：对 question 做向量相似度检索
 * @param {string} question 查询文本
 * @param {number} k        返回条数
 * @returns 结构化的文档数组（每条含 score 相似度、content 正文、以及 Milvus 元数据）
 * similaritySearchWithScore 返回 [Document, score][] 对，score 越小越相似（距离）；
 * 代码把原始 Document 拍平成便于下游拼接的纯对象，并给元数据提供兜底默认值。
 */
async function retrieveRelevantContent(question, k = TOP_K) {
    try {
        const docsWithScores = await vectorStore.similaritySearchWithScore(question, k);
        return docsWithScores.map(([doc, score]) => ({
            score,
            content: doc.pageContent,
            id: doc.metadata?.id ?? "unknown",
            book_id: doc.metadata?.book_id ?? "未知",
            chapter_num: doc.metadata?.chapter_num ?? "未知",
            index: doc.metadata?.index ?? "未知",
        }));
    } catch (error) {
        console.error("检索内容时出错:", error.message);
        return []; // 检索失败不中断流程，返回空数组让生成节点自行兜底
    }
}

/** 节点① 检索：把用户问题送进向量库，把命中的片段写入 state.documents */
const retrieveNode = async (state) => {
    const documents = await retrieveRelevantContent(state.question, state.k);
    return {
        question: state.question,
        k: state.k,
        documents,
    };
};

/** 节点② 生成：把检索片段拼成上下文，让模型流式生成基于事实的回答 */
const generateNode = async (state) => {
    // 把多个检索片段拼接成带编号、带章节信息的上下文文本，供模型参考
    const context = state.documents
        .map(
            (item, i) =>
                `[片段 ${i + 1}]
章节: 第 ${item.chapter_num} 章
内容: ${item.content}`,
        )
        .join("\n\n━━━━━\n\n");

    // 组装 RAG 提示词：明确要求「基于片段回答、信息不足要如实说明」
    const prompt = `你是一个专业的《天龙八部》小说助手。基于小说内容回答问题，用准确、详细的语言。

请根据以下《天龙八部》小说片段内容回答问题：
${context}

用户问题: ${state.question}

回答要求：
1. 如果片段中有相关信息，请结合小说内容给出详细、准确的回答
2. 可以综合多个片段的内容，提供完整的答案
3. 如果片段中没有相关信息，请如实告知用户
4. 回答要准确，符合小说的情节和人物设定
5. 可以引用原文内容来支持你的回答

AI 助手的回答:`;

    // 流式输出：边接收边打印，同时累积完整回答写入 state.generation
    process.stdout.write("\n【AI 回答（流式）】\n");
    let generation = "";
    const stream = await model.stream(prompt);
    for await (const chunk of stream) {
        const text = typeof chunk.content === "string" ? chunk.content : "";
        if (!text) continue; // 跳过空片段
        generation += text;
        process.stdout.write(text);
    }
    process.stdout.write("\n");

    return {
        question: state.question,
        k: state.k,
        documents: state.documents,
        generation,
    };
};

/**
 * 构图：两个节点一条直线
 *   addNode 注册节点 → addEdge 连接（addEdge(起点, 终点)，顺序不可颠倒）
 *   START 是入口哨兵节点，END 是出口哨兵节点
 */
const graph = new StateGraph(GraphState)
    .addNode("retrieve", retrieveNode)
    .addNode("generate", generateNode)
    .addEdge(START, "retrieve")       // 入口先检索
    .addEdge("retrieve", "generate")  // 检索完生成
    .addEdge("generate", END)         // 生成完结束
    .compile();

async function main() {
    const question = "阿朱的结局是什么？";
    const kArg = 5;

    // 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
    const drawable = await graph.getGraphAsync();
    const mermaid = drawable.drawMermaid({ withStyles: true });
    console.log(mermaid);

    // ===== 连接 Milvus 向量库 =====
    console.log("连接到 Milvus...");
    vectorStore = await Milvus.fromExistingCollection(embeddings, {
        collectionName: COLLECTION_NAME,
        url: "localhost:19530", // Milvus 默认端口
        textField: "content",   // 文档正文字段
        primaryField: "id",     // 主键字段
        vectorField: "vector",  // 向量字段
        indexCreateOptions: {
            metric_type: "COSINE",       // 相似度度量方式：余弦
            index_type: "HNSW",          // 索引类型
            params: { M: 16, efConstruction: 200 }, // HNSW 图参数
            search_params: { ef: 64 },   // 检索时的探索广度（越大越准越慢）
        },
    });
    // 显式覆盖检索参数（部分版本需要单独设置才生效）
    vectorStore.indexSearchParams = { metric_type: "COSINE", params: JSON.stringify({ ef: 64 }) };
    console.log("✓ 已连接\n");

    // 加载集合到内存，使其可被检索（Milvus 的 loadCollection 是异步完成的）
    try {
        await vectorStore.client.loadCollection({ collection_name: COLLECTION_NAME });
        console.log(`✓ 集合 ${COLLECTION_NAME} 已加载\n`);
    } catch (error) {
        if (!error.message.includes("already loaded")) {
            throw error; // 非「已加载」类错误要重新抛出，不能静默吞掉
        }
        console.log(`✓ 集合 ${COLLECTION_NAME} 已处于加载状态\n`);
    }

    console.log("=".repeat(80));
    console.log(`问题: ${question}`);
    console.log("=".repeat(80));

    // ==================== 为什么 invoke 要传这样一个对象？ ====================
    // 因为 invoke 传入的对象就是 state 的「初始值」（起点黑板），而每个节点
    // (state) => {...} 返回的对象是 state 的「增量更新」——它们共享同一套字段
    // 集合（由上面的 GraphState 声明）。这是 LangGraph 的核心机制。
    //
    // 整个执行过程就像一块「黑板」被沿途传递、逐步填写：
    //
    //   invoke({ question, k, documents: [], generation: "" })   ← 初始黑板
    //        │
    //        ▼
    //   retrieveNode(state) 读 question/k → 返回 { documents, ... }   ← 写黑板
    //        │  框架自动合并：question/k 不变、documents 被填上
    //        ▼
    //   generateNode(state) 读 question/documents → 返回 { generation, ... } ← 写黑板
    //        │  框架自动合并：generation 被填上
    //        ▼
    //   invoke 返回最终 state（黑板全貌：question + k + documents + generation）
    //
    // 每个节点函数签名都是 (state) => {...}：读当前黑板 → 返回要改写的字段 →
    // 框架把返回值合并进黑板（默认「后写覆盖先写」）。所以 invoke 的参数和
    // 节点的返回值是同一套字段，只是一个是起点、一个是沿途的更新；最终 result
    // 里能拿到什么字段，取决于节点们返回过什么字段。
    //
    // 那这 4 个字段为什么都要传？
    //   question    : 必须——整个流程的输入，没有任何节点会生成它
    //   k           : 必须——检索条数参数，同理没有节点会生成
    //   documents   : 可选但建议——稍后 retrieve 节点会写入，传 [] 保证流程
    //                 启动时字段就有确定值，避免生成节点读到 undefined
    //   generation  : 同理，占位用——真正内容由 generate 节点写入
    //
    // 严格来说只传 { question, k } 也能跑（retrieve 返回时会把 documents 补上），
    // 但传空初始值是防御性写法：让每个节点随时读 state.documents /
    // state.generation 都不会碰到 undefined，也方便后续加节点时字段不缺失。
    //
    // 一句话总结：invoke() 传入的 = 起点黑板，节点返回的 = 中间更新，
    // invoke() 返回的 = 终点黑板。三者是同一结构。
    const result = await graph.invoke({
        question,
        k: Number.isFinite(kArg) ? kArg : TOP_K,
        documents: [],
        generation: "",
    });

    // ===== 打印检索详情 =====
    console.log("\n【检索相关内容】");
    if (result.documents.length === 0) {
        console.log("未找到相关内容");
        console.log("\n【AI 回答】");
        console.log("抱歉，我没有找到相关的《天龙八部》内容。");
        return;
    } else {
        result.documents.forEach((item, i) => {
            console.log(`\n[片段 ${i + 1}] 相似度: ${item.score.toFixed(4)}`);
            console.log(`书籍: ${item.book_id}`);
            console.log(`章节: 第 ${item.chapter_num} 章`);
            console.log(`片段索引: ${item.index}`);
            console.log(
                `内容: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`,
            );
        });
    }

    // 生成为空时给出提示（例如模型未返回任何 token）
    if (!result.generation) {
        console.log("\n【AI 回答】");
        console.log("模型未返回内容。");
    }
}

main()
