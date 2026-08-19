/**
 * 内存检查点（MemorySaver）演示：
 * 同一个 thread_id 的多次 invoke 共享状态（visitCount 不断累加），
 * 不同 thread_id 相互隔离，互不干扰。
 * 运行：node src/checkpointer-memory.mjs
 */
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";

// 状态定义：visitCount 记录访问次数，message 记录给用户的提示语
const StateAnnotation = Annotation.Root({
  visitCount: Annotation({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  message: Annotation({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

/** 每跑一轮图，给「当前会话」访问次数 +1 */
function recordVisit(state) {
  const visitCount = state.visitCount + 1;
  const message =
    visitCount === 1
      ? "这是你在本会话里第 1 次进入。"
      : `这是你在本会话里第 ${visitCount} 次进入`;
  return { visitCount, message };
}

// 图结构：START -> recordVisit -> END
const graph = new StateGraph(StateAnnotation)
  .addNode("recordVisit", recordVisit)
  .addEdge(START, "recordVisit")
  .addEdge("recordVisit", END);

// MemorySaver 把每轮状态快照存在内存里（进程退出即丢失，重启归零）
const checkpointer = new MemorySaver();
const app = graph.compile({ checkpointer });

// thread_id 用于区分不同「会话」：小张连续跑 3 次，小李单独跑 1 次
const user1 = { configurable: { thread_id: "用户-小张" } };
const user2 = { configurable: { thread_id: "用户-小李" } };

const res1 = await app.invoke({}, user1);
const res2 = await app.invoke({}, user1);
const res3 = await app.invoke({}, user1);
const res4  = await app.invoke({}, user2);

console.log(res1)
console.log(res2);
console.log(res3);
console.log(res4);
