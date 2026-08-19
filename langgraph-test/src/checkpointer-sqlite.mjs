/**
 * SQLite 持久化检查点演示：
 * 用 SqliteSaver 把每轮状态快照写入本地 sqlite 文件，
 * 进程重启后会话状态依然保留（与 MemorySaver 的区别所在）。
 * 运行：node src/checkpointer-sqlite.mjs
 */
import { existsSync, unlinkSync } from "node:fs";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

// 演示用的 sqlite 数据库文件路径（脚本启动时会先删掉旧库保证演示干净）
const dbPath = "./src/checkpointer-demo.sqlite";

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

// 节点：每次给当前会话访问次数 +1，并生成提示语
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

// 清掉上一次演示留下的旧库文件，保证从 0 开始
if (existsSync(dbPath)) {
  unlinkSync(dbPath);
}

// 用 sqlite 作为检查点后端：状态快照落盘，进程重启也能恢复
const checkpointer = SqliteSaver.fromConnString(dbPath);
const app = graph.compile({ checkpointer });

// thread_id 用于区分不同「会话」：小张连续跑 3 次，小李单独跑 1 次
const user1 = { configurable: { thread_id: "用户-小张" } };
const user2 = { configurable: { thread_id: "用户-小李" } };

const res1 = await app.invoke({}, user1);
const res2 = await app.invoke({}, user1);
const res3 = await app.invoke({}, user1);
const res4 = await app.invoke({}, user2);

console.log(res1);
console.log(res2);
console.log(res3);
console.log(res4);
