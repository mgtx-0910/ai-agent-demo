/**
 * 最基本的 StateGraph 演示：
 * 定义 1 个状态字段 text，串联 step1 -> step2 两个节点，
 * 最后导出 Mermaid 图并打印执行结果。
 * 运行：node src/basic-graph.mjs
 */
import "dotenv/config";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

// 状态定义：reducer 取「后写覆盖先写」，default 提供初始值 ""
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

// 构图：START -> step1 -> step2 -> END，线性顺序执行
const graph = new StateGraph(StateAnnotation)
  .addNode("step1", step1)
  .addNode("step2", step2)
  .addEdge(START, "step1")
  .addEdge("step1", "step2")
  .addEdge("step2", END)
  .compile();

// 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
const drawable = await graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyles: true });
console.log(mermaid);

// 执行图：传入初始状态，得到最终状态
const result = await graph.invoke({ text: "hello" });
console.log("result:", result);
