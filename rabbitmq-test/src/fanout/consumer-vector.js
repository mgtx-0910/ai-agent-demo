import { connect } from '../config.js';

const EXCHANGE = 'doc.parse.fanout';
/** 本消费者专属队列：只负责「分片 + 写入向量库」 */
const QUEUE = 'doc.vectorize';

/**
 * ============================================================
 * fanout 消费者 A：模拟向量化写入 Milvus
 * ============================================================
 *
 * 【要点】
 *   - 每个处理环节用自己的 Queue，再 bind 到同一个 fanout Exchange
 *   - Exchange 广播时，每条消息都会「复制」进每个绑定队列
 *   - 所以 vector 队列和 es 队列会各自收到完整消息，互不影响消费进度
 *
 * 【关键区分：多队列 vs 多消费者】
 *   同样是「监听同一个 Exchange」，两种做法的语义完全不同：
 *
 *   多队列（本示例）：每个队列各拿一份完整消息 → 两条链路各处理一遍
 *                     Queue doc.vectorize     ──► 向量化
 *                     Queue doc.elasticsearch ──► 写 ES
 *
 *   单队列多消费者：同一个队列上挂多个消费者 → 消息被「瓜分」，
 *                   每条消息只交给其中一个消费者（Broker 轮询分发），
 *                   用于水平扩容、提高吞吐，而不是「多路处理」。
 *
 *   记法：想「都做一遍」就多建队列；想「分摊压力」就多加消费者。
 */
async function main() {
  // 消费者是常驻监听，不主动关连接，所以只要 channel
  const { channel } = await connect();

  /**
   * 消费者侧也要 assertExchange：保证交换机存在，且类型与生产者一致。
   * 两端谁先启动都不影响 —— assert 是幂等的，先到的一方负责创建。
   */
  await channel.assertExchange(EXCHANGE, 'fanout', { durable: true });

  /**
   * assertQueue：声明真正存消息的容器（消息只存在 Queue 里，交换机不存）。
   *
   * durable: true → 队列定义持久化；消息本身还要生产端配合 persistent 才能落盘。
   *
   * 【一个实用特性】因为队列在这里被声明，即使消费者还没启动、
   * 只要队列已存在且已绑定，消息就会堆在队列里等下次消费，不会丢。
   * 这就是 README 里说「第一次必须按顺序、之后可以随意」的原因。
   */
  await channel.assertQueue(QUEUE, { durable: true });

  /**
   * bindQueue(queue, exchange, routingKey)
   *
   * fanout 不看 routing key，第三个参数传空字符串即可（传别的也不会错，
   * 但传空更能表达「这里不参与路由」）。
   * 绑定成功后：凡是发到该 Exchange 的消息，都会进入本队列。
   */
  await channel.bindQueue(QUEUE, EXCHANGE, '');

  console.log(`[fanout] 向量化消费者监听队列: ${QUEUE}`);

  /**
   * consume：注册消费者，之后进入阻塞等待（推模式，Broker 主动送）。
   *
   * 默认需要手动 ack（见下方 channel.ack）：处理成功再确认，
   * 这样进程崩溃时未 ack 的消息会重新投递，避免任务丢失。
   */
  channel.consume(QUEUE, (msg) => {
    // 消费者被取消时可能收到 null（例如队列被删除），直接返回
    if (!msg) return;

    /**
     * 反序列化：msg.content 是 Buffer，对应生产端的 Buffer.from(JSON.stringify(...))。
     * 两端格式必须对称，否则会解析失败或得到 "[object Object]"。
     */
    const data = JSON.parse(msg.content.toString());
    console.log('[vector] 收到消息，开始分片并写入 Milvus:', data.docId, data.source);

    /**
     * 实际项目里这里会做：切 chunk → embedding → upsert Milvus。
     * 那是个耗时操作（可能几秒到几十秒），这也正是用异步队列的理由：
     * 解析接口发完消息就能立刻返回，不必等向量化完成。
     *
     * 处理成功后再 ack；若失败可 nack / reject 决定是否重入队
     * （重入队要有次数上限，否则一条坏消息会无限循环投递）。
     */
    channel.ack(msg);
  });
}

main().catch(console.error);
