// ============================================================================
// 数据库连接模块
// ----------------------------------------------------------------------------
// 职责：
//   1. 加载 .env 环境变量，读取 DATABASE_URL 创建 pg 连接池（Pool）
//   2. 导出统一封装的 query()，供 users / conversations / messages 各模块调用
//
// 使用示例：
//   import { query } from "./db.mjs";
//   const { rows } = await query("SELECT * FROM users WHERE id = $1", [1]);
// ============================================================================
import "dotenv/config"; // 注入环境变量（.env 文件位于项目根目录）
import pg from "pg";

const { Pool } = pg;

// 连接池：多个请求复用底层连接，避免每次查询都新建连接的开销
const pool = new Pool({
  // 形如 postgres://user:123456@localhost:5432/hello_pg（见 README 环境变量说明）
  connectionString: process.env.DATABASE_URL
});

/**
 * 执行参数化查询。
 * SQL 中的 $1、$2... 占位符由 pg 驱动做转义绑定，天然防止 SQL 注入。
 * @param {string} text SQL 语句
 * @param {unknown[]} [params] 与占位符一一对应的参数数组
 * @returns {Promise<import("pg").QueryResult>} pg 查询结果
 */
async function query(text, params) {
  return pool.query(text, params);
}

export { pool, query };
