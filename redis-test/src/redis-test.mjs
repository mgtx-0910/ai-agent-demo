// ============================================================================
// Redis 核心数据类型快速演示（ioredis 驱动）
// ----------------------------------------------------------------------------
// 覆盖内容：
//   String（字符串）/ Hash（哈希）/ List（列表）/ Set（集合）
//   ZSet（有序集合）/ 分布式锁（SET NX EX 标准写法）
// 运行：node src/redis-test.mjs（需先 docker compose up -d 启动 Redis）
// 说明：本脚本直连 localhost:6379（db 0），未读取 .env；
//       如需修改连接地址，请直接调整下方 new Redis({...}) 参数。
// ============================================================================
import Redis from 'ioredis';

// 创建 Redis 客户端
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  db: 0
});

// 连接成功监听
redis.on('connect', () => {
  console.log('✅ ioredis 连接成功（mjs 版）');
});

// 错误监听（例如 Redis 未启动时会在此回调收到 ECONNREFUSED）
redis.on('error', (err) => {
  console.error('❌ Redis 连接失败：', err);
});

// 执行操作
async function runRedisDemo() {
  try {
    // =========================
    // 1. String 字符串
    //    场景：验证码 / Token / 计数器 / 配置项 / 分布式锁
    // =========================
    await redis.set('name', '张三');
    await redis.set('code', '6666', 'EX', 300); // EX 300 = 300 秒后自动过期（模拟验证码）
    console.log('String name:', await redis.get('name'));

    // =========================
    // 2. Hash 哈希
    //    场景：对象型结构化存储（用户信息、商品资料、购物车）
    //    结构：key -> { field: value, ... }
    // =========================
    await redis.hset('user:1001', 'name', '李四', 'age', 28);
    console.log('Hash user:', await redis.hgetall('user:1001'));

    // =========================
    // 3. List 列表
    //    场景：消息队列、任务队列、浏览 / 聊天历史
    // =========================
    await redis.lpush('task:list', '任务1', '任务2'); // 左侧（头部）入队
    await redis.rpush('task:list', '任务3');         // 右侧（尾部）入队
    console.log('List:', await redis.lrange('task:list', 0, -1)); // 取全部（0 到 -1）

    // =========================
    // 4. Set 集合
    //    场景：去重、签到、标签、黑白名单（无序且自动去重）
    // =========================
    await redis.sadd('tag:set', 'redis', 'nest', 'node');
    console.log('Set:', await redis.smembers('tag:set'));

    // =========================
    // 5. ZSet 有序集合
    //    场景：排行榜、热度排序（member 携带 score，按分数排序）
    // =========================
    await redis.zadd('score:rank', 99, '小明', 95, '小红'); // 参数：分数在前，成员在后
    console.log('ZSet 排名:', await redis.zrange('score:rank', 0, -1)); // 默认按分数升序

    // =========================
    // 6. 分布式锁（标准写法）
    //    NX = 仅当 key 不存在时才写入（互斥）；EX 10 = 10 秒自动过期（防死锁）
    // =========================
    const lockKey = 'lock:order:1001';
    const lockResult = await redis.set(lockKey, 'locked', 'NX', 'EX', 10);
    console.log('分布式锁:', lockResult ? '加锁成功' : '加锁失败');

  } catch (err) {
    console.error('执行异常：', err);
  }
}

// 运行
runRedisDemo();
