// ============================================================================
// 消息表（messages）数据访问模块 —— 本项目核心
// ----------------------------------------------------------------------------
// 在普通 CRUD 之外，额外提供两项「AI 能力」：
//   1. 写入/更新消息时可选附带向量（embedding），列类型为 pgvector 的 vector(1024)
//   2. searchSimilarMessages() 用向量余弦距离（<=>）做语义相似度检索
//
// 向量由 OpenAIEmbeddings 生成：
//   - 默认模型 text-embedding-v3，输出 1024 维（与建表 SQL 的 vector(1024) 对齐）
//   - 可通过 EMBEDDING_MODEL / OPENAI_BASE_URL 环境变量更换模型或网关
// ============================================================================
import "dotenv/config"; // 注入环境变量
import { OpenAIEmbeddings } from "@langchain/openai";
import { query } from "./db.mjs";

// messages.role 允许的取值（与建表 SQL 中的 CHECK 约束保持一致）
const VALID_ROLES = ["user", "assistant", "system"];

// 模块级单例缓存：embedding 客户端只在首次使用时初始化一次
let embeddings;

/**
 * 惰性初始化 embedding 客户端（避免模块加载即触发网络/密钥检查）
 * @returns {OpenAIEmbeddings}
 */
function getEmbeddings() {
  if (!embeddings) {
    embeddings = new OpenAIEmbeddings({
      model: process.env.EMBEDDING_MODEL || "text-embedding-v3",
      apiKey: process.env.OPENAI_API_KEY,
      configuration: {
        baseURL: process.env.OPENAI_BASE_URL, // 兼容 OpenAI 协议的网关地址
      },
    });
  }
  return embeddings;
}

/**
 * 新建消息。
 * @param {number} conversationId 所属会话 id
 * @param {string} role 消息角色，仅允许 VALID_ROLES 中的值
 * @param {string} content 消息文本
 * @param {boolean} [withEmbedding=false] 为 true 时额外计算内容向量并入库
 * @returns 插入后的消息行
 */
async function createMessage(conversationId, role, content, withEmbedding = false) {
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`role 必须是 ${VALID_ROLES.join("、")} 之一`);
  }

  if (withEmbedding) {
    // 先调 embedding 模型把文本转成 1024 维向量，再与消息一起写入
    const vector = await getEmbeddings().embedQuery(content);
    const { rows } = await query(
      `INSERT INTO messages (conversation_id, role, content, embedding)
       VALUES ($1, $2, $3, $4::vector)
       RETURNING id, conversation_id, role, content, created_at`,
      // pgvector 接受 JSON 数组文本，$4::vector 负责将其转换为向量类型
      [conversationId, role, content, JSON.stringify(vector)]
    );
    return rows[0];
  }

  // 普通消息：不写 embedding（检索时 WHERE embedding IS NOT NULL 自然过滤）
  const { rows } = await query(
    `INSERT INTO messages (conversation_id, role, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [conversationId, role, content]
  );
  return rows[0];
}

/** 按主键查询消息（返回不含 embedding 的轻量行） */
async function getMessageById(id) {
  const { rows } = await query(
    `SELECT id, conversation_id, role, content, created_at
     FROM messages WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/** 查询某个会话内的全部消息（按创建时间正序，即聊天顺序） */
async function getMessagesByConversationId(conversationId) {
  const { rows } = await query(
    `SELECT id, conversation_id, role, content, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );
  return rows;
}

/**
 * 更新消息内容；withEmbedding 为 true 时同步重算并覆盖向量，
 * 保证后续语义检索仍以最新内容为准。
 */
async function updateMessage(id, content, withEmbedding = false) {
  if (withEmbedding) {
    const vector = await getEmbeddings().embedQuery(content);
    const { rows } = await query(
      `UPDATE messages
       SET content = $1, embedding = $2::vector
       WHERE id = $3
       RETURNING id, conversation_id, role, content, created_at`,
      [content, JSON.stringify(vector), id]
    );
    return rows[0] ?? null;
  }

  const { rows } = await query(
    `UPDATE messages SET content = $1 WHERE id = $2 RETURNING *`,
    [content, id]
  );
  return rows[0] ?? null;
}

/** 删除消息，返回是否删除成功 */
async function deleteMessage(id) {
  const { rowCount } = await query("DELETE FROM messages WHERE id = $1", [id]);
  return rowCount > 0;
}

/**
 * 语义相似度检索（核心能力）。
 * 原理：把查询文本转成同一空间的向量，用 pgvector 的余弦距离（<=>）
 * 与库内消息向量比较，距离越小越相似。
 * @param {number} conversationId 限定检索范围：仅在某会话内查找
 * @param {string} searchText 查询文本（会先经 embedding 模型向量化）
 * @param {number} [limit=5] 返回条数上限
 * @returns {Promise<Array<{similarity: string} & Record<string, unknown>>}
 *   行对象，其中 similarity = 1 - 余弦距离，取值 0~1，越大越相似
 */
async function searchSimilarMessages(conversationId, searchText, limit = 5) {
  const vector = await getEmbeddings().embedQuery(searchText);
  const { rows } = await query(
    `SELECT id, conversation_id, role, content, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM messages
     WHERE conversation_id = $2 AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [JSON.stringify(vector), conversationId, limit]
  );
  return rows;
}

export {
  createMessage,
  getMessageById,
  getMessagesByConversationId,
  updateMessage,
  deleteMessage,
  searchSimilarMessages,
};
