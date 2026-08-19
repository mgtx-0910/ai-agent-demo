/**
 * 条件路由演示：
 * router 节点根据 query 是否包含数学运算符（+ - * /），
 * 通过 addConditionalEdges 把流程分到 math 或 chat 节点。
 * 运行：node src/conditional-routing.mjs
 */
import "dotenv/config";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

// 状态定义：query 是用户输入，route 记录路由结果，answer 是最终回答
const StateAnnotation = Annotation.Root({
  query: Annotation({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  route: Annotation({
    reducer: (_prev, next) => next,
    default: () => "chat",
  }),
  answer: Annotation({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

// 路由节点：判断 query 是否含 + - * /，决定走 math 还是 chat
const router = (state) => {
  const isMath = /[+\-*/]/.test(state.query);
  return { route: isMath ? "math" : "chat" };
};

// 数学节点：尝试直接 eval 表达式（仅演示用，生产环境切勿对输入执行 eval）
const mathNode = (state) => {
  try {
    return { answer: String(eval(state.query)) };
  } catch {
    return { answer: "表达式无法计算" };
  }
};

// 聊天节点：把输入原样回显
const chatNode = (state) => ({ answer: `你说的是：${state.query}` });

// 构图：START -> router，router 按 route 字段条件分流到 math / chat，各自到 END
const graph = new StateGraph(StateAnnotation)
  .addNode("router", router)
  .addNode("math", mathNode)
  .addNode("chat", chatNode)
  .addEdge(START, "router")
  .addConditionalEdges("router", (state) => state.route, {
    math: "math",
    chat: "chat",
  })
  .addEdge("math", END)
  .addEdge("chat", END)
  .compile();

// 导出为 Mermaid：可复制到 https://mermaid.live 或 Markdown 的 ```mermaid 代码块
const drawable = await graph.getGraphAsync();
const mermaid = drawable.drawMermaid({ withStyles: true });
console.log(mermaid);

// 普通文本走 chat 分支
console.log(
  "result:",
  await graph.invoke({ query: "你好" })
);

// 带运算符的表达式走 math 分支
console.log(
    "result:",
    await graph.invoke({ query: "10 * 8" })
);
