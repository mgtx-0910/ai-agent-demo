/**
 * 条件边 + 循环重试演示：
 * attempt 节点模拟「前 2 次失败、第 3 次成功」，
 * 通过条件边在失败时跳回自身节点重试，成功后才走向 END。
 * 运行：node src/loop-retry.mjs
 */
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

// 状态定义：tries 记录尝试次数，ok 标记是否成功，message 记录提示语
const StateAnnotation = Annotation.Root({
  tries: Annotation({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  ok: Annotation({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  message: Annotation({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

// 尝试节点：每次 +1，达到 3 次才算成功
const attempt = (state) => {
  const tries = state.tries + 1;
  const ok = tries >= 3;
  return {
    tries,
    ok,
    message: ok ? `第 ${tries} 次成功` : `第 ${tries} 次失败，继续重试`,
  };
};
MemorySaver

// 构图：START -> attempt；失败则条件边回到 attempt，成功则到 END
const graph = new StateGraph(StateAnnotation)
  .addNode("attempt", attempt)
  .addEdge(START, "attempt")
  .addConditionalEdges("attempt", (state) => (state.ok ? "done" : "retry"), {
    retry: "attempt",
    done: END,
  })
  .compile();

// 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
const drawable = await graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyles: true });
console.log(mermaid);

// 从 tries=0 开始执行，观察它如何重试 2 次后成功
const result = await graph.invoke({ tries: 0 });
console.log("result:", result);
