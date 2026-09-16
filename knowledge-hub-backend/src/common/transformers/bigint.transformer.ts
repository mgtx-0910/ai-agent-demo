import { ValueTransformer } from 'typeorm';

/**
 * Postgres BIGINT ↔ JS string
 * 雪花 ID 超过 Number 安全整数范围，必须用字符串，否则会丢精度。
 *
 * 挂在所有 BIGINT 列上（id / categoryId / teamId / authorId / createBy / updateBy），
 * 作用有两个：
 *   读出：pg 驱动可能把 BIGINT 返回成 string（或数字），统一归一化为 string
 *   写入：原样透传字符串，由驱动按 BIGINT 处理
 */
export const bigintTransformer: ValueTransformer = {
  to: (v) => v, // 写入：原样交给驱动
  from: (v) => (v == null ? v : String(v)), // 读出：统一转成 string（null / undefined 保持原样）
};
