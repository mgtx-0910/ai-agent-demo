import SnowflakeId from 'snowflake-id';

/**
 * 雪花 ID 生成器（全局单例）
 *
 * 雪花 ID = 时间戳 + 机器号 + 自增序列，特点：
 *   - 64 位整数、趋势递增（可做主键，比 UUID 的随机写入对 B+ 树更友好）
 *   - 分布式下不依赖数据库自增，多实例各配一个 mid 即可避免撞号
 *
 * mid    ：机器 ID，取值 0–1023，同一集群内每个实例必须唯一
 * offset ：纪元偏移（毫秒），会从当前时间里减掉，用于延长可用年限
 *
 * ⚠️ 这两个值在「模块 import 阶段」就从 process.env 读取，
 * 而 .env 是由 ConfigModule.forRoot() 在稍后才写入 process.env 的，
 * 因此 .env 里的 SNOWFLAKE_WORKER_ID / SNOWFLAKE_OFFSET 实际不会生效，稳定取默认值。
 * 想让它生效，二选一：
 *   1) 用真正的系统环境变量（启动前 export / 容器 env 注入）
 *   2) 把读取挪到运行时（注入 ConfigService，或在 bootstrap 最前面先加载 dotenv）
 */
const snowflake = new SnowflakeId({
  mid: Number(process.env.SNOWFLAKE_WORKER_ID ?? 1),
  offset: Number(process.env.SNOWFLAKE_OFFSET ?? 1704067200000),
});

/**
 * 生成雪花 ID，返回 string
 *
 * 为什么是 string 而不是 number：64 位整数远超 JS 的安全整数范围（2^53-1），
 * 用 number 会在序列化时静默丢精度（末位变 0），因此全链路统一走 string，
 * 与 Postgres BIGINT 之间由 bigintTransformer 负责转换。
 */
export function nextSnowflakeId(): string {
  return snowflake.generate();
}
