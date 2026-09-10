import { connect } from '../config.js';

/** 交换机名称。Producer 只往 Exchange 发消息，从不直接写某个 Queue。 */
const EXCHANGE = 'doc.parse.fanout';

/**
 * ============================================================
 * 实验二 · fanout 交换机 —— 广播
 * ============================================================
 *
 * 【行为】把消息广播到所有绑定了该交换机的 Queue，完全忽略 routing key。
 *
 * 【业务场景（RAG 里非常典型）】
 *   文档解析完成后得到 Markdown → 发一条消息到 fanout
 *   → 向量化消费者、ES 消费者各自绑定自己的队列，都能收到同一份消息副本
 *   → 两边异步并行处理，解析接口不必同步等待两个耗时写入
 *
 * 【和 direct 的关系】fanout 相当于「所有队列都绑了同一个空 key」的 direct。
 *   它的价值在于「生产端不需要知道下游有谁」：今天接向量库、明天加 ES、
 *   后天再加一个摘要服务，都只是新增一个消费者脚本，生产者一行都不用改。
 *   代价是没法筛选 —— 要么都收，要么不绑。
 */

async function main() {
  const { connection, channel } = await connect();

  /**
   * assertExchange：交换机不存在则创建，已存在则校验类型是否一致。
   * - type: 'fanout' 广播模式。若之前用同名建过 direct 交换机，这里会报 406
   * - durable: true  交换机定义在 Broker 重启后仍保留（消息是否持久另看消息属性）
   */
  await channel.assertExchange(EXCHANGE, 'fanout', { durable: true });

  /**
   * 模拟「解析接口」产出的业务载荷。
   * 真实项目里这里可能就是几百 KB 的 Markdown 正文，因此更要避免
   * 同步等待下游写入 —— 消息队列的意义就在于把「产出」和「处理」在时间上拆开。
   */
  const message = {
    docId: `doc-${Date.now()}`,
    markdown: '# Hello RAG\n\n这是解析后的 Markdown 内容。',
    source: 'report.pdf',
  };

  /**
   * publish(exchange, routingKey, content, options)
   *
   * - fanout 下第二个参数 routingKey 会被完全忽略，习惯上传空字符串 ''。
   *   （传什么都不会报错，但传空能让读代码的人一眼看出「这里不参与路由」。）
   * - content 必须是 Buffer：AMQP 搬的是字节串，对象要先序列化。
   *   消费端对应 JSON.parse(msg.content.toString())，两端必须对称。
   * - persistent: true  标记消息持久化，配合 durable 队列，Broker 重启后尽量不丢
   *                     （严格不丢还要配合发布确认、仲裁队列等，这里先演示基本用法）
   * - contentType      纯元数据，RabbitMQ 不解析，供消费端判断如何反序列化
   *
   * 【注意】publish 不返回 Promise，只写本地缓冲就返回。
   * 所以下面必须等一会儿再关连接，否则消息可能还没发出去连接就断了。
   */
  channel.publish(EXCHANGE, '', Buffer.from(JSON.stringify(message)), {
    persistent: true,
    contentType: 'application/json',
  });

  console.log('[fanout producer] 已发送:', message);

  /**
   * 给底层缓冲一点时间把消息刷出去，再关连接（演示脚本写法）。
   * 500ms 是经验值；要确定性送达应改用 confirm channel：
   *   const ch = await connection.createConfirmChannel();
   *   ch.publish(...); await ch.waitForConfirms();
   *
   * 另外必须显式 close()，否则 TCP 连接还在，Node 进程不会退出。
   */
  setTimeout(async () => {
    await channel.close();
    await connection.close();
  }, 500);
}

main().catch(console.error);
