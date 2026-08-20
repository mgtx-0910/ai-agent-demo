/**
 * 最基本的 StateGraph 演示：
 * 定义 1 个状态字段 text，串联 step1 -> step2 两个节点，
 * 最后导出 Mermaid 图并打印执行结果。
 * 运行：node src/basic-graph.mjs
 */
import "dotenv/config";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

/**
 * 状态 schema 定义（整张图的"状态户口本"）：
 * Annotation.Root({...}) 声明顶层状态结构，每个键是一个字段，
 * 每个字段用 Annotation({ reducer, default }) 声明它的规则：
 *   - reducer: 合并策略，签名 (旧值, 新值) => 最终值。
 *     这里 (_prev, next) => next 表示「新值直接覆盖旧值」；
 *     换成 [...prev, ...next] 就是数组追加，prev + next 就是累加。
 *   - default: 初始值，当 invoke 没传该字段或节点没返回它时兜底。
 * 
 *    _prev = 当前全局状态里的旧值（下划线开头表示"我不打算用它"）
 *    next = 节点刚返回的新值
 *    函数体 => next = "别管旧的，直接拿新的覆盖"
 *    reducer: (_prev, next) => next 的签名就是 (旧值, 新值) => 最终值：
 *
 * LangGraph 关键设计：节点只返回「部分更新」（只写自己关心的字段），
 * 运行时由 LangGraph 按 reducer 规则把更新合并回全局状态。
 * 所以这里定义覆盖式 reducer，节点返回 { text: "..." } 就会整体替换 text。
 */
const StateAnnotation = Annotation.Root({
  text: Annotation({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

// 节点 1：在 text 末尾追加 " -> step1"
const step1 = (state) => ({ text: `${state.text} -> step1` });
// 节点 2：在 text 末尾追加 " -> step2"
const step2 = (state) => ({ text: `${state.text} -> step2` });

/**
 * 构图核心逻辑（LangGraph 的"画图三步走"）：
 * 1. new StateGraph(StateAnnotation)  —— 开一张空"画布"，
 *    带上状态户口本 StateAnnotation，图就清楚节点间流动的数据长什么样。
 * 2. addNode("名字", 函数)            —— 摆"工位"：第一个参数是节点名字（连线用它引用），
 *    第二个参数是真正干活的函数。函数入参为当前全局状态，返回"部分的更新"，
 *    由 StateAnnotation 里的 reducer 合并回全局状态（这里即"新值覆盖旧值"）。
 * 3. addEdge(源, 目标)                —— 拉"流水线"：决定执行顺序。
 *    START / END 是内置特殊节点：START 为入口，END 为出口。
 *
 * 拓扑结构：START ──▶ step1 ──▶ step2 ──▶ END
 * 调用 invoke({ text: "hello" }) 后，状态像流水线上的零件被逐个工位加工：
 *   "hello" -> step1 追加 -> step2 追加 -> 返回 { text: "hello -> step1 -> step2" }
 *
 * 为什么节点要"起名字"而不是直接连函数？
 *   条件路由（运行时按状态选路）、Mermaid 可视化、检查点/中断恢复
 *   都靠"节点有名字"才能定位，所以名字是 LangGraph 的"地址"。
 *
 * 最后一行的 compile() 是把"图纸"编译成"能跑的机器"：
 * 前面只是描述结构，compile 后才可调用（invoke）。不 compile 无法运行。
 */
const graph = new StateGraph(StateAnnotation)
  .addNode("step1", step1)
  .addNode("step2", step2)
  .addEdge(START, "step1")
  .addEdge("step1", "step2")
  .addEdge("step2", END)
  .compile();

/**
 * 为什么 START/END 不用真实节点表示？
 * 因为"入口"和"出口"不是要执行的步骤，只是图的边界标记。
 * 这样设计的好处：终点不是写死的。比如加一条 addEdge("step1", END)，
 * 就能让 step1 干完直接结束、跳过 step2——出口可以多个，
 * 入口也可以是条件路由（见 conditional-routing.mjs 里 router 节点动态选路）。
 * 一句话总结：addEdge(START, "step1") 是"入口指向第一站"，
 * addEdge("step2", END) 是"最后一站指向出口"，START/END 是虚拟边界，真实干活的只有 step1、step2。
 */

// 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
const drawable = await graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyles: true });
console.log(mermaid);

// 执行图：传入初始状态，得到最终状态
const result = await graph.invoke({ text: "hello" });
console.log("result:", result);
