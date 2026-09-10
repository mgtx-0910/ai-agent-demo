import { connect } from '../config.js';

/**
 * 与生产者使用完全相同的交换机名。
 * 两端名字只要差一个字符，就是两个不同的交换机 —— 消息永远碰不到面，
 * 而且不会报任何错，属于最难排查的一类问题。
 */
const EXCHANGE = 'doc.task.direct';

/**
 * 从命令行参数取要绑定的 routing key，不传时默认 info。
 *
 * 【npm 传参的坑】`npm run xxx error` 里的 error 会被 npm 自己吞掉，
 * 必须用 `--` 分隔，它后面的参数才会透传给脚本：
 *
 *   node src/direct/consumer.js error     → 可用
 *   npm  run direct:consumer -- error     → 可用
 *   npm  run direct:consumer error        → 不可用（error 被 npm 吃掉）
 *
 * process.argv 的下标约定：
 *   argv[0] = node 可执行文件路径
 *   argv[1] = 当前脚本路径
 *   argv[2] = 第一个业务参数        ← 所以从 2 开始读
 */
const routingKey = process.argv[2] || 'info';

/**
 * 队列名按 binding key 拼出来（doc.task.info / doc.task.error）：
 *   - 每个 key 一个独立队列，方便在管理台一眼看出「谁在听什么」
 *
 * 【队列属于谁？】队列由「声明它的客户端」创建，但消息存在 Broker 上。
 * 不同进程只要用同一个队列名，操作的就是同一个队列 —— 这正是本节能在
 * 两个终端分别跑 info / error 消费者的原因。
 */
const QUEUE = `doc.task.${routingKey}`;

/**
 * direct 消费者：只接收 binding key === 消息 routing key 的消息。
 *
 * 绑定关系示意：
 *   Queue(doc.task.info)    --bind key=info-->    Exchange(direct)
 *   Queue(doc.task.error)   --bind key=error-->   Exchange(direct)
 *
 * 发 routingKey=info 的消息 → 只进 doc.task.info
 * 发 routingKey=error 的消息 → 只进 doc.task.error
 */
async function main() {
  /**
   * 消费者只需要 channel：consume 是常驻监听，进程靠 Ctrl+C 退出，
   * 不主动 close，所以没有取 connection。
   */
  const { channel } = await connect();

  // 交换机必须先在 Broker 上存在，否则 bindQueue 会报 404 NOT_FOUND 并关闭 channel
  await channel.assertExchange(EXCHANGE, 'direct', { durable: true });

  /**
   * assertQueue(queue, options)：声明真正存消息的容器。
   *
   * 【幂等，但参数必须一致】队列已存在时，Broker 会把本次声明的参数与
   * 已有队列比对，不一致就抛 406 PRECONDITION_FAILED
   * （例如上次建队列时 durable 是 false，这次改成 true）。
   * 遇到这种错，要么改回一致参数，要么在管理台删掉队列重建。
   *
   * durable: true → 队列「定义」持久化。它只保证队列还在，
   * 队列里的消息要不要落盘，取决于生产端 publish 时的 persistent。
   * 两者都开才叫「Broker 重启不丢消息」。
   */
  await channel.assertQueue(QUEUE, { durable: true });

  /**
   * bindQueue(queue, exchange, bindingKey)
   *
   * 语义：告诉 Broker「把我的队列挂到这个交换机上，匹配规则是 bindingKey」。
   * 这一步建立起 Exchange → Queue 的投递路径，是「路由」的全部秘密所在：
   *   - 没绑定        → 交换机收到消息后无处可投，消息被静默丢弃（不报错）
   *   - 绑定但匹配不上 → 同样不投（direct 下必须逐字符相等）
   *
   * 【binding key 属于消费者】这是常被忽视的一点：生产者只管发一个
   * routing key，用哪个 key 订阅完全由消费者决定。所以新增一个消费方
   * （比如再开一个绑 warning 的队列）根本不需要改生产者。
   */
  await channel.bindQueue(QUEUE, EXCHANGE, routingKey);

  console.log(`[direct] 消费者监听队列=${QUEUE}, routingKey=${routingKey}`);

  /**
   * consume(queue, onMessage, options)
   *
   * 【推模式】调用后客户端告诉 Broker「有消息就推给我」，然后原地阻塞等待。
   * 所以消费者脚本跑起来后不会退出，也不会空转占 CPU。
   * 注意这不是轮询 —— 没有任何「每隔几秒问一次」的动作，是 Broker 主动推。
   *
   * options 常用项：
   *   noAck: false（默认）→ 手动确认模式，处理完必须 ack，否则消息一直占着
   *   noAck: true         → 自动确认，Broker 一发出就认为已处理（吞吐高但可能丢消息）
   * 本项目一律用默认的手动确认，以便演示「处理失败可重投」。
   */
  channel.consume(QUEUE, (msg) => {
    /**
     * 收到 null 说明该消费者被取消（例如队列被删除 / channel 关闭），
     * 此时应当停止处理。生产代码通常在这里收尾并退出进程。
     */
    if (!msg) return;

    /**
     * msg 的结构（了解它能在排查时省很多时间）：
     *   msg.content     Buffer，就是生产端 Buffer.from 的那些字节
     *   msg.fields      { exchange, routingKey, deliveryTag, redelivered, ... }
     *                   → 消息「从哪来、怎么来的」
     *   msg.properties  { contentType, headers, deliveryMode, ... }
     *                   → 生产端 publish 时设置的属性
     *
     * 反序列化必须与生产端严格对称：
     *   这里 JSON.parse(msg.content.toString())
     *   对应生产端 Buffer.from(JSON.stringify(...))
     */
    const data = JSON.parse(msg.content.toString());
    console.log(`[direct/${routingKey}] 收到:`, data);

    /**
     * 手动确认（noAck 为 false 时必须调用，否则消息永远不释放）。
     *
     *   ack(msg)    → 处理成功，Broker 从队列删除这条消息
     *   nack(msg)   → 处理失败，可要求重新入队或丢弃（本示例未演示）
     *   reject(msg) → 拒绝单条，等价于 nack 的单条版本
     *
     * 【不 ack 会怎样】消息进入 unacked 状态一直占着 —— 管理台 Queues 页
     * 的 Unacked 列就是这个数。若进程崩溃，Broker 会把未 ack 的消息重新
     * 投给其他消费者，这就是「至少一次投递」：不丢消息，但可能重复，
     * 所以业务侧必须保证幂等（比如按 docId 去重）：
     *
     * 【顺序绝不能反】必须先处理业务、再 ack。
     * 反例：先 ack 再处理业务 —— 业务还没跑完进程挂了，消息已删、
     * 任务永久丢失。记住「处理完再 ack」。
     */
    channel.ack(msg);
  });
}

main().catch(console.error);
