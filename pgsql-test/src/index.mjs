// ============================================================================
// 演示入口：串起全部能力做一次端到端验证
// ----------------------------------------------------------------------------
// 流程：用户 CRUD → 会话 CRUD → 消息 CRUD → 语义相似度检索
// 运行：npm start（等价于 node src/index.mjs）
// 前置：PostgreSQL 已启动（docker compose up -d）且 .env 已按 README 配置
// ============================================================================
import { pool } from "./db.mjs";
import * as users from "./users.mjs";
import * as conversations from "./conversations.mjs";
import * as messages from "./messages.mjs";

async function run() {
  console.log("=== 用户 CRUD ===");

  // 创建用户 -> 按 id 查询 -> 改名
  const user = await users.createUser("张三");
  console.log("创建用户:", user);

  const fetchedUser = await users.getUserById(user.id);
  console.log("查询用户:", fetchedUser);

  const updatedUser = await users.updateUser(user.id, "李四");
  console.log("更新用户:", updatedUser);

  console.log("\n=== 会话 CRUD ===");

  // 沿用上面创建的 user.id，演示「一个用户 -> 多个会话」的归属关系
  const conversation = await conversations.createConversation(
    user.id,
    "第一次对话"
  );
  console.log("创建会话:", conversation);

  const userConversations = await conversations.getConversationsByUserId(
    user.id
  );
  console.log("用户的会话列表:", userConversations);

  const updatedConversation = await conversations.updateConversation(
    conversation.id,
    { title: "更新后的标题" }
  );
  console.log("更新会话:", updatedConversation);

  console.log("\n=== 消息 CRUD ===");

  // 普通消息（不带 embedding）：用户提问 + AI 回答各一条
  const userMessage = await messages.createMessage(
    conversation.id,
    "user",
    "你好，请介绍一下 PostgreSQL"
  );
  console.log("创建用户消息:", userMessage);

  const assistantMessage = await messages.createMessage(
    conversation.id,
    "assistant",
    "PostgreSQL 是一个功能强大的开源关系型数据库。"
  );
  console.log("创建 AI 消息:", assistantMessage);

  const conversationMessages = await messages.getMessagesByConversationId(
    conversation.id
  );
  console.log("会话消息列表:", conversationMessages);

  const updatedMessage = await messages.updateMessage(
    userMessage.id,
    "你好，请介绍一下 pgvector"
  );
  console.log("更新消息:", updatedMessage);

  console.log("\n=== 语义检索 ===");

  // 写入一批「带 embedding」的种子消息作为检索库
  const seedMessages = [
    { role: "user", content: "PostgreSQL 支持哪些数据类型？" },
    {
      role: "assistant",
      content:
        "PostgreSQL 支持整数、文本、JSON、数组，以及 pgvector 扩展提供的向量类型。",
    },
    { role: "user", content: "怎么做相似度搜索？" },
    {
      role: "assistant",
      content:
        "可以使用 pgvector 的 cosine 距离运算符 <=>，配合 hnsw 索引加速向量检索。",
    },
  ];

  for (const msg of seedMessages) {
    // createMessage 第 4 个参数 true = 写入时同时计算并存储 embedding
    await messages.createMessage(
      conversation.id,
      msg.role,
      msg.content,
      true
    );
  }
  console.log(`已写入 ${seedMessages.length} 条带 embedding 的消息`);

  // 用「语义相近但不逐字相同」的问题做检索，验证向量检索而非关键词匹配
  const searchQueries = ["向量相似度怎么查", "关系型数据库有哪些类型"];

  for (const searchText of searchQueries) {
    console.log(`\n搜索: "${searchText}"`);
    const results = await messages.searchSimilarMessages(
      conversation.id,
      searchText,
      3
    );
    if (results.length === 0) {
      console.log("  无匹配结果");
      continue;
    }
    for (const [i, row] of results.entries()) {
      console.log(
        `  ${i + 1}. [${row.role}] ${row.content} (similarity: ${Number(row.similarity).toFixed(4)})`
      );
    }
  }

  // 演示数据默认保留，便于反复查看；如需清理可取消下方注释
  // console.log("\n=== 清理 ===");

  // await messages.deleteMessage(assistantMessage.id);
  // await messages.deleteMessage(updatedMessage.id);
  // await conversations.deleteConversation(conversation.id);
  // await users.deleteUser(user.id);

  // console.log("演示数据已清理");
}

run()
  .catch((err) => {
    console.error("运行失败:", err.message);
    process.exit(1);
  })
  .finally(() => pool.end()); // 演示结束后关闭连接池，让进程正常退出

export { users, conversations, messages };
