/**
 * 故意在图节点里抛错，用于验证本地日志是否能看到失败 run。
 * 运行：node src/trigger-error.mjs
 *
 * 若需要「未捕获的 Promise rejection」观察进程行为，可删掉下方 try/catch，
 * 仅保留 await graph.invoke(...)。
 */
import "dotenv/config";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

// 状态定义：只有一个 text 字段，reducer 取「后写覆盖先写」
const StateAnnotation = Annotation.Root({
  text: Annotation({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

// 正常节点：往 text 上追加 "[ok]"
const stepOk = (state) => ({ text: `${state.text}[ok]` });

// 抛错节点：故意抛出异常，验证错误能被上层 try/catch 捕获
const stepThrow = () => {
  throw new Error("DemoError: 节点内故意抛错（trigger-error.mjs）");
};

// 构图：START -> step_ok -> step_throw -> END（执行到 step_throw 必然中断）
const graph = new StateGraph(StateAnnotation)
  .addNode("step_ok", stepOk)
  .addNode("step_throw", stepThrow)
  .addEdge(START, "step_ok")
  .addEdge("step_ok", "step_throw")
  .addEdge("step_throw", END)
  .compile();

// 捕获图执行中的异常并打印，进程以非 0 码退出
try {
  await graph.invoke({ text: "start" });
  console.log("不应执行到这里");
} catch (err) {
  console.error("已捕获:", err?.message ?? err);
  process.exitCode = 1;
}
