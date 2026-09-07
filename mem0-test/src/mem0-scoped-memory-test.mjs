/**
 * Mem0 三种记忆 scope 的 API 测试
 *
 * Mem0 的记忆可用三个维度归属（scope），互不干扰：
 *   user_id  → 用户长期记忆（换会话仍能认出用户）
 *   run_id   → 单次会话 / 任务的记忆（仅当前 session 有效）
 *   agent_id → 某个 Agent 自身属性的记忆（角色设定、回答风格等）
 * 检索时用 filters 组合，例如 { AND: [{ user_id: USER_ID }, { run_id: RUN_ID }] }。
 *
 * 说明：add 是异步抽取，提交后需稍等再 search，因此 add / search 分开调用。
 *
 * 运行：node src/mem0-scoped-memory-test.mjs            （add 三种 scope）
 *        node src/mem0-scoped-memory-test.mjs search    （分别 search 三种 scope）
 *        node src/mem0-scoped-memory-test.mjs --cleanup （清理三种 scope 的测试数据）
 */
import "dotenv/config";
import { MemoryClient } from "mem0ai";

// 三个 scope 的固定测试标识：分别对应「用户层 / 会话层 / Agent 层」
const USER_ID = "mem0_test_user";
const RUN_ID = "mem0_test_session";
const AGENT_ID = "mem0_test_agent";

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

// 写入「用户层记忆」：只带 userId，不带 runId / agentId
async function addUserMemory(client) {
  const messages = [
    { role: "user", content: "我叫小明，住在杭州，平时喜欢骑行和摄影。" },
    { role: "assistant", content: "好的，已记住你的姓名、城市和爱好。" },
  ];
  const added = await client.add(messages, { userId: USER_ID });
  log("用户记忆 — add", added);
}

// 检索用户层记忆：限定 user_id，验证长期事实能否被召回
async function searchUserMemory(client) {
  const searched = await client.search("用户住在哪里，有什么爱好", {
    filters: { user_id: USER_ID },
    topK: 5,
  });
  log("用户记忆 — search", searched.results?.map((m) => m.memory) ?? []);

  const listed = await client.getAll({ filters: { user_id: USER_ID }, pageSize: 5 });
  log("用户记忆 — getAll", listed.results?.map((m) => m.memory) ?? []);
}

// 写入「会话层记忆」：user_id + run_id 组合，只归属当前会话
async function addSessionMemory(client) {
  const messages = [
    { role: "user", content: "这次聊天先帮我把季度总结的大纲列出来，重点写 Q1 的项目复盘。" },
    { role: "assistant", content: "明白，我们先围绕 Q1 项目复盘整理季度总结大纲。" },
  ];
  const added = await client.add(messages, { userId: USER_ID, runId: RUN_ID });
  log("会话记忆 — add", added);
}

// 检索会话层记忆：AND 组合 user_id + run_id，只找本会话内的事
async function searchSessionMemory(client) {
  const searched = await client.search("这次对话要先做什么", {
    filters: { AND: [{ user_id: USER_ID }, { run_id: RUN_ID }] },
    topK: 5,
  });
  log("会话记忆 — search", searched.results?.map((m) => m.memory) ?? []);

  const listed = await client.getAll({
    filters: { AND: [{ user_id: USER_ID }, { run_id: RUN_ID }] },
    pageSize: 5,
  });
  log("会话记忆 — getAll", listed.results?.map((m) => m.memory) ?? []);
}

// 写入「Agent 层记忆」：只带 agentId，与具体用户 / 会话无关
async function addAgentMemory(client) {
  const messages = [
    { role: "user", content: "你现在是旅行规划助手，回答时多给具体建议和备选方案。" },
    { role: "assistant", content: "好的，我会以旅行规划助手的身份，提供具体建议和备选方案。" },
  ];
  const added = await client.add(messages, { agentId: AGENT_ID });
  log("Agent 记忆 — add", added);
}

// 检索 Agent 层记忆：限定 agent_id
async function searchAgentMemory(client) {
  const searched = await client.search("这个 Agent 的角色和回答方式", {
    filters: { agent_id: AGENT_ID },
    topK: 5,
  });
  log("Agent 记忆 — search", searched.results?.map((m) => m.memory) ?? []);

  const listed = await client.getAll({ filters: { agent_id: AGENT_ID }, pageSize: 5 });
  log("Agent 记忆 — getAll", listed.results?.map((m) => m.memory) ?? []);
}

async function main() {
  if (!process.env.MEM0_API_KEY) {
    console.error("缺少 MEM0_API_KEY");
    process.exit(1);
  }

  // 连接 Mem0 云端（MEM0_API_KEY 在 .env 中配置）
  const client = new MemoryClient({ 
    apiKey: process.env.MEM0_API_KEY
  });
  // 命令行动作：add / search / --cleanup
  const action = process.argv[2] ?? "add";

  // --cleanup：清除三种 scope 下的测试记忆
  if (process.argv.includes("--cleanup")) {
    await client.deleteAll({ userId: USER_ID });
    await client.deleteAll({ userId: USER_ID, runId: RUN_ID });
    await client.deleteAll({ agentId: AGENT_ID });
    log("清理完成", { USER_ID, RUN_ID, AGENT_ID });
    return;
  }

  // add：向三种 scope 各写入一条记忆（异步抽取，稍后再 search 验证）
  if (action === "add") {
    await addUserMemory(client);
    await addSessionMemory(client);
    await addAgentMemory(client);
    console.log("\nadd 已提交（异步处理），稍后再运行: pnpm scoped-memory search");
    return;
  }

  // search：分别检索三种 scope，验证记忆归属与相互隔离
  if (action === "search") {
    await searchUserMemory(client);
    await searchSessionMemory(client);
    await searchAgentMemory(client);
    return;
  }

  console.error(`未知命令: ${action}，可用: add | search | --cleanup`);
  process.exit(1);
}

main().catch((error) => {
  console.error("\n执行失败:", error.message ?? error);
  if (error.suggestion) console.error("建议:", error.suggestion);
  process.exit(1);
});
