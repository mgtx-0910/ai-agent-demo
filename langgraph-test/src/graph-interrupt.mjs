/**
 * interrupt 中断/恢复演示：
 * 图执行到 waitConfirm 节点时通过 interrupt() 暂停，返回给调用方等待用户输入；
 * 调用方用 new Command({ resume }) 把用户的回答交回，图从暂停点继续执行。
 * 运行：node src/graph-interrupt.mjs（需在终端交互输入）
 */
import { createInterface } from "node:readline/promises";
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";

// 状态定义：actionSummary 记录待确认动作，userInput 记录用户 resume 的值
const StateAnnotation = Annotation.Root({
  actionSummary: Annotation({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  userInput: Annotation({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

/** 展示一笔待确认的转账 */
const showTransfer = () => ({
  actionSummary: "向张三转账 ¥100（模拟，不会真扣款）",
});

/** 停在这里等人输入；resume 的值会写进 userInput */
const waitConfirm = (state) => {
  const text = interrupt({
    hint: "终端里输入「确认」或备注后回车，图才会继续",
    actionSummary: state.actionSummary,
  });
  return { userInput: String(text) };
};

// 构图：START -> showTransfer -> waitConfirm -> END，并挂上内存检查点
// （interrupt 必须配合 checkpointer 才能保存暂停点）
const graph = new StateGraph(StateAnnotation)
  .addNode("showTransfer", showTransfer)
  .addNode("waitConfirm", waitConfirm)
  .addEdge(START, "showTransfer")
  .addEdge("showTransfer", "waitConfirm")
  .addEdge("waitConfirm", END)
  .compile({ checkpointer: new MemorySaver() });

// 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
const drawable = await graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyles: true });
console.log(mermaid);

const config = { configurable: { thread_id: "interrupt-demo" } };

// 第一次 invoke：会停在 waitConfirm，返回 __interrupt__ 里带的提示信息
const paused = await graph.invoke({}, config);
console.log("\n待你确认：", paused.__interrupt__?.[0]?.value);

// 在终端等用户输入，作为「确认/备注」内容
const rl = createInterface({ input: process.stdin, output: process.stdout });
const line = (await rl.question("> ")).trim();
await rl.close();

// 没输入就直接退出
if (!line) {
  console.error("未输入，退出。");
  process.exit(1);
}

// 第二次 invoke：用 Command.resume 把输入交给图，从暂停点继续执行到 END
const done = await graph.invoke(new Command({ resume: line }), config);
console.log("结果：", done);
