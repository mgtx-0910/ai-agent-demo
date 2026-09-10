import amqp from 'amqplib';

/**
 * ============================================================
 * 连接层：Connection 与 Channel
 * ============================================================
 *
 * 一个 AMQP 客户端与 Broker 之间有两级结构：
 *
 *   amqp.connect()         → Connection：一条真实的 TCP 连接
 *        └ createChannel() → Channel：连接上的逻辑通道
 *
 * 【为什么要分两级？】
 *   TCP 建连很贵（三次握手 + AMQP 协议协商 + 用户认证 + vhost 校验）。
 *   如果每种用途都单独开一条 TCP，开销和连接数都会爆炸。
 *   于是 AMQP 设计了 Channel：多条逻辑通道复用同一条 TCP，
 *   各自的操作互不干扰。实际项目常见「1 个 Connection + 3 个 Channel」，
 *   分别用于声明拓扑、发布、消费。
 *
 * 【重要限制】Channel 不是线程安全的。
 *   同一个 Channel 上不要并发交叉调用，否则可能出现
 *   「A 请求的响应被当成 B 请求的响应」这类错位。
 *   Node 是单线程，加上本项目全程顺序 await，天然规避了这个问题。
 *
 * 【本文件在链路里的位置】
 *   Connection → Channel → Exchange → (Binding) → Queue → Consumer
 *                       ↑ 你在这里
 */

/**
 * RabbitMQ 连接串（AMQP URI）格式：
 *
 *   amqp://用户名:密码@主机:端口/vhost
 *              ↑      ↑         ↑
 *          URL 编码后     虚拟主机（多租户隔离，默认 "/"）
 *
 * ------------------------------------------------------------
 * 【最容易踩的坑】密码里的特殊字符必须做 URL 编码
 * ------------------------------------------------------------
 * 本示例密码是 Admin@123456，其中的 @ 必须写成 %40：
 *
 *   错误：amqp://admin:Admin@123456@localhost:5672
 *        解析器按「最后一个 @ 之前是凭据」的规则去拆，
 *        会把用户名解析成 "admin:Admin"，直接认证失败。
 *
 *   正确：amqp://admin:Admin%40123456@localhost:5672
 *
 * 需要编码的常见字符：
 *   @ → %40    : → %3A    / → %2F    # → %23    ? → %3F
 * 记忆点：凡是在 URI 里有语法含义的字符，都要转义。
 *
 * ------------------------------------------------------------
 * 也可以用环境变量覆盖（本项目没有引入 dotenv）
 * ------------------------------------------------------------
 *   PowerShell:
 *     $env:RABBITMQ_URL = "amqp://guest:guest@localhost:5672"; npm run direct:producer
 *
 * 好处：切换本地 / 测试 / 生产环境时不用改代码，
 *       也不会把带密码的连接串提交进仓库。
 */
export const RABBITMQ_URL =
  process.env.RABBITMQ_URL ||
  'amqp://admin:Admin%40123456@localhost:5672';

/**
 * 建立连接并开出一条 Channel，返回 { connection, channel }。
 *
 * 两个对象的分工：
 *   connection —— 代表与 Broker 的物理连接，进程退出前要 close，
 *                 否则那条 TCP 还挂着，Node 不会自动结束
 *   channel    —— 真正干活的对象，声明交换机/队列、publish、consume 都用它
 *
 * 【两种角色的关闭时机不同】
 *   生产者：消息发完就可以 close（脚本自然结束）
 *   消费者：consume 是常驻监听，不 close，靠 Ctrl+C 退出
 *   所以本项目里生产者解构 { connection, channel }，消费者只解构 { channel }，
 *   这不是随意写的，而是由「谁需要主动退出」决定的。
 */
export async function connect() {
  // 1. 建立 TCP 连接并完成认证（对应架构图里的 Connection）
  //    这行会真正发起网络请求，host / 端口 / 账号 / 密码 / vhost 任一有错都在这里抛异常，
  //    ECONNREFUSED 说明服务没起来，ACCESS_REFUSED 说明凭据或权限不对。
  const connection = await amqp.connect(RABBITMQ_URL);

  // 2. 在连接上开一条逻辑通道（对应架构图里的 Channel）
  //    后面的 assertExchange / assertQueue / bindQueue / publish / consume 全走 channel。
  //    一个 channel 上可以顺序做很多事，也可以按需再开新 channel。
  const channel = await connection.createChannel();

  return { connection, channel };
}
