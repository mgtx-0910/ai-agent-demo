/**
 * graphrag.mjs —— 基于 Neo4j 知识图谱的 GraphRAG 工作流
 *
 * 核心思路：让 LLM 先把自然语言问题转成 Cypher 查询语句，
 * 去 Neo4j 图谱里检索「结构化事实」，再让 LLM 基于检索结果生成回答。
 * 相比普通向量 RAG（语义相似度召回），图 RAG 更适合回答
 * 「有哪些配料」「属于什么类型」这类关系明确、需要精确多跳的问题。
 *
 * 流程（LangGraph 状态机，3 个节点直线串联）：
 *   START → generateCypher（问题 → Cypher）
 *         → executeGraph（Cypher → 图谱检索结果）
 *         → generateAnswer（检索结果 → 最终回答）
 *         → END
 *
 * 前置条件：
 *   1. Neo4j 已启动（docker-compose.yml，bolt://localhost:7687，neo4j/12345678）
 *   2. 图谱中已存在奶茶领域的节点/关系数据（可先用 neo4j-test.mjs 或种子脚本灌入）
 *   3. .env 已配置 OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME
 *
 * 运行：node src/graphrag.mjs
 */
import 'dotenv/config' // 加载 .env 到 process.env
import { Neo4jGraph } from '@langchain/community/graphs/neo4j_graph' // LangChain 的 Neo4j 图封装（带 schema 刷新能力）
import { ChatOpenAI } from '@langchain/openai' // OpenAI 兼容协议的对话模型
import { StateGraph, END, START } from '@langchain/langgraph' // LangGraph 状态图编排
import { HumanMessage } from '@langchain/core/messages' // 消息类型：用户输入

// ----------------------
// 连接 Neo4j 知识图谱
// ----------------------
// Neo4jGraph 是 LangChain 提供的图数据库封装：
// 除了执行 Cypher，还会自动刷新并缓存图谱 schema（节点/关系结构），
// 后续可作为上下文注入 prompt，帮助 LLM 生成更准确的 Cypher。
const graph = new Neo4jGraph({
  url: 'bolt://localhost:7687', // Bolt 协议地址，与 docker-compose 映射端口一致
  username: 'neo4j',
  password: '12345678',
})

// ----------------------
// 大模型
// ----------------------
// ChatOpenAI：走 OpenAI 兼容协议（这里指向阿里云百炼 DashScope）
// temperature=0：图谱问答要「事实准确」，关闭随机性，答案更稳定
const llm = new ChatOpenAI({
  model: process.env.MODEL_NAME, // 模型名，从 .env 读取（如 qwen-plus）
  temperature: 0,
  configuration: { baseURL: process.env.OPENAI_BASE_URL }
})

// ----------------------
// 定义状态（LangGraph 各节点共享的「黑板」）
// ----------------------
// channels 里每个字段都声明了合并策略：
//  - value:  消息列表的合并规则（left.concat(right)），支持追加多条消息
//  - default: 状态初始化时的默认值（messages 初始为 []）
//  - cypher/context/answer 不写合并策略，表示「覆盖式」写入
const state = {
  messages: {
    value: (left, right) =>
      left.concat(Array.isArray(right) ? right : [right]), // 右值可能是单条或数组，统一拼进列表
    default: () => [], // 初始为空消息列表
  },
  cypher: null,   // 步骤1产物：LLM 生成的 Cypher 语句
  context: null,  // 步骤2产物：图谱检索到的 JSON 结果
  answer: null,   // 步骤3产物：最终回答
}

// 从状态的消息列表里取出最后一条用户消息的文本，作为「当前问题」
function userQuery(state) {
  const last = state.messages[state.messages.length - 1]
  return last.content
}

// ----------------------
// 步骤1：生成 Cypher
// ----------------------
// 把用户问题 + 图谱结构约束（节点/关系方向/规则）拼进 prompt，
// 让 LLM 只输出一段可执行的纯 Cypher。返回字段名 cypher 必须与 state 声明一致，
// 否则会被 LangGraph 静默丢弃。
async function generateCypher(state) {
    const prompt = `
      你是一个专业的 Neo4j Cypher 生成器。
      严格按照下面的结构生成正确语句，只返回纯 Cypher 代码，不要任何解释、不要标点、不要 markdown。

      节点：
      - Product: 奶茶产品
      - Ingredient: 配料
      - Type: 奶茶类型
      - Method: 制作工艺
      - People: 适合人群

      关系方向（必须严格遵守）：
      - (Product)-[:属于]->(Type)
      - (Product)-[:包含]->(Ingredient)
      - (Product)-[:适合]->(People)
      - (Ingredient)-[:使用]->(Method)

      规则：
      1. 关系方向绝对不能反
      2. 多跳查询请使用多个 MATCH，不要连错路径
      3. 只返回最终可运行的 Cypher 语句

      用户问题：${userQuery(state)}
    `
    const res = await llm.invoke([new HumanMessage(prompt)])
    return { cypher: res.content } // 增量更新状态里的 cypher 字段
  }

// ----------------------
// 步骤2：执行图查询
// ----------------------
// 把上一步生成的 Cypher 交给 Neo4j 执行，结果转成 JSON 字符串存入 context。
// 失败时兜底为「未查询到相关知识」，避免一条坏 Cypher 让整个流程崩溃。
async function executeGraphQuery(state) {
  try {
    const res = await graph.query(state.cypher) // graph.query 直接执行 Cypher 并返回记录
    return { context: JSON.stringify(res) } // 序列化后交给步骤3
  } catch (e) {
    return { context: '未查询到相关知识' } // 查询失败：降级为兜底文案，不中断流程
  }
}

// ----------------------
// 步骤3：生成答案
// ----------------------
// 把「检索结果 + 用户问题」交给 LLM 做最终回答。
// prompt 里强调：只依据图谱中真实存在的事实，不编造图谱里没有的配料。
async function generateAnswer(state) {
  const prompt = `
    你是奶茶专家，根据下方「检索结果」回答用户问题；检索结果为空或不足时简要说明无法从图谱得到答案，不要编造。
    回答要求：
    - 直接列出事实，不要推断图谱里未出现的配料（如水、冰、添加剂等）。

    检索结果：${state.context}
    用户问题：${userQuery(state)}
  `
  const res = await llm.invoke([new HumanMessage(prompt)])
  return { answer: res.content } // 增量更新状态里的 answer 字段
}

// ----------------------
// 构建 LangGraph 工作流
// ----------------------
// 三个节点按固定顺序串联：generateCypher → executeGraph → generateAnswer
// StateGraph 接收 channels 定义（即上面的 state），编译后得到一个可 invoke 的应用
const workflow = new StateGraph({ channels: state })
  .addNode('generateCypher', generateCypher) // 注册节点：节点名 + 处理函数
  .addNode('executeGraph', executeGraphQuery)
  .addNode('generateAnswer', generateAnswer)
  .addEdge(START, 'generateCypher') // 固定边：入口 → 步骤1
  .addEdge('generateCypher', 'executeGraph') // 步骤1 → 步骤2
  .addEdge('executeGraph', 'generateAnswer') // 步骤2 → 步骤3
  .addEdge('generateAnswer', END) // 步骤3 → 结束

// compile() 生成可执行的应用实例（app.invoke 即启动一次完整流程）
const app = workflow.compile()

// 打印工作流的 Mermaid 图（便于在支持 Mermaid 的 Markdown 预览里直观查看图结构）
async function printWorkflowMermaid() {
  const drawable = await app.getGraphAsync() // 获取图的绘制对象
  const mermaid = drawable.drawMermaid({ withStyles: true }) // 导出 Mermaid 源码
  console.log('--- LangGraph 工作流 (Mermaid) ---')
  console.log(mermaid)
  console.log('-----------------------------------------------------------')
}

// ----------------------
// 运行 GraphRAG
// ----------------------
// 入口函数：invoke 一个 HumanMessage，走完整个状态机，
// 最后打印每一阶段的产物（Cypher / 检索结果 / 最终回答），便于观察中间过程。
async function runGraphRAG(question) {
  const res = await app.invoke({
    messages: [new HumanMessage(question)], // 初始状态：只有一条用户消息
  })

  // 打印完整链路结果：问题 → 生成的 Cypher → 图查询结果 → 最终回答
  console.log('======================================')
  console.log('用户问题：', question)
  console.log('生成 Cypher：', res.cypher)
  console.log('检索结果：', res.context)
  console.log('最终回答：', res.answer)
  console.log('======================================')
}

// ======================
// 测试
// ======================
// 自执行入口：先打印工作流图，再并发跑 3 个典型问题
// 并发调用同一个 app 是安全的（LangGraph 每次 invoke 都是独立状态副本）
;(async () => {
  await printWorkflowMermaid()
  await Promise.all([
    runGraphRAG('我们这款珍珠奶茶有哪些配料？'),
    runGraphRAG('台式奶茶的饮品都有哪些配料？'),
    runGraphRAG('珍珠奶茶适合哪些人群饮用？'),
  ])
})().catch(console.error) // 顶层异常兜底打印
