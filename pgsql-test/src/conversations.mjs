// ============================================================================
// 会话表（conversations）数据访问模块
// ----------------------------------------------------------------------------
// 数据归属关系：users（1）-> conversations（N）-> messages（N）。
// 一条会话归属于某个用户，其下可挂多条消息；删除会话时级联删除消息。
// ============================================================================
import { query } from "./db.mjs";

/** 为用户创建新会话（title 可省略，缺省为 null） */
async function createConversation(userId, title = null) {
  const { rows } = await query(
    "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING *",
    [userId, title]
  );
  return rows[0];
}

/** 按主键查询单个会话（查不到返回 null） */
async function getConversationById(id) {
  const { rows } = await query(
    "SELECT * FROM conversations WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

/** 查询某用户下的全部会话（按创建时间倒序，最新的在前） */
async function getConversationsByUserId(userId) {
  const { rows } = await query(
    "SELECT * FROM conversations WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows;
}

/** 查询全部会话（按创建时间倒序） */
async function getAllConversations() {
  const { rows } = await query(
    "SELECT * FROM conversations ORDER BY created_at DESC"
  );
  return rows;
}

/** 修改会话标题（title 由调用方对象解构传入），返回更新后的行 */
async function updateConversation(id, { title }) {
  const { rows } = await query(
    "UPDATE conversations SET title = $1 WHERE id = $2 RETURNING *",
    [title, id]
  );
  return rows[0] ?? null;
}

/** 删除会话（级联删除其下消息），返回是否删除成功 */
async function deleteConversation(id) {
  const { rowCount } = await query(
    "DELETE FROM conversations WHERE id = $1",
    [id]
  );
  return rowCount > 0;
}

export {
  createConversation,
  getConversationById,
  getConversationsByUserId,
  getAllConversations,
  updateConversation,
  deleteConversation,
};
