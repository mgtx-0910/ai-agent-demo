// ============================================================================
// 用户表（users）数据访问模块
// ----------------------------------------------------------------------------
// 提供对 users 表的增删改查（CRUD），函数均返回「行对象」或「行对象数组」。
// 删除用户时会通过外键 ON DELETE CASCADE 级联删除其名下会话与消息。
// ============================================================================
import { query } from "./db.mjs";

/** 新建用户，RETURNING * 直接返回插入后的完整行 */
async function createUser(name) {
  const { rows } = await query(
    "INSERT INTO users (name) VALUES ($1) RETURNING *",
    [name]
  );
  return rows[0];
}

/** 按主键查询单个用户（查不到返回 null） */
async function getUserById(id) {
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}

/** 查询全部用户（按 id 升序） */
async function getAllUsers() {
  const { rows } = await query("SELECT * FROM users ORDER BY id");
  return rows;
}

/** 更新用户名称，返回更新后的行（用户不存在返回 null） */
async function updateUser(id, name) {
  const { rows } = await query(
    "UPDATE users SET name = $1 WHERE id = $2 RETURNING *",
    [name, id]
  );
  return rows[0] ?? null;
}

/** 删除用户（级联删除其会话与消息），返回是否删除成功 */
async function deleteUser(id) {
  const { rowCount } = await query("DELETE FROM users WHERE id = $1", [id]);
  return rowCount > 0;
}

export {
  createUser,
  getUserById,
  getAllUsers,
  updateUser,
  deleteUser,
};
