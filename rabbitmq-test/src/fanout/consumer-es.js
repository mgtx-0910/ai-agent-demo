import { connect } from '../config.js';

const EXCHANGE = 'doc.parse.fanout';
/** 本消费者专属队列：只负责「全文检索写入 ElasticSearch」 */
const QUEUE = 'doc.elasticsearch';

/**
 * ============================================================
 * fanout 消费者 B：模拟写入 ElasticSearch
 * ============================================================
 *
 * 与 consumer-vector.js 绑定同一 Exchange、不同 Queue。
 * 生产者只发一次；两个队列各收一份，天然实现「一份 Markdown → 两路异步落地」。
 *
 * 【两个消费者脚本几乎一模一样，是刻意的】
 *   它们之间没有任何耦合：删掉其中一个，另一个照常工作；
 *   新增第三个（比如摘要生成），也只是复制这个文件改队列名 + 业务逻辑。
 *   这就是「生产者不需要知道下游有谁」的直观体现 —— 扩消费方零成本。
 *
 * 【为什么两个队列名不同？】
 *   队列名就是「这条链路的工作台账」。如果两个环节共用一个队列，
 *   消息会被瓜分（每条只交给其中一个消费者），变成「向量化和 ES 二选一」，
 *   那显然不是想要的。详见 consumer-vector.js 里「多队列 vs 多消费者」的说明。
 */
async function main() {
  const { channel } = await connect();

  // 保证交换机存在且类型一致（幂等，谁先启动谁创建）
  await channel.assertExchange(EXCHANGE, 'fanout', { durable: true });

  /**
   * 声明本环节专属队列。
   * durable: true 表示队列定义落盘；再配合生产端的 persistent，
   * 才能做到「Broker 重启后消息仍在队列里」。
   */
  await channel.assertQueue(QUEUE, { durable: true });

  // 同样绑定到 fanout；routing key 仍可传空（fanout 忽略它）
  await channel.bindQueue(QUEUE, EXCHANGE, '');

  console.log(`[fanout] ES 消费者监听队列: ${QUEUE}`);

  channel.consume(QUEUE, (msg) => {
    // 消费者被取消时可能收到 null，此时不再处理
    if (!msg) return;

    // 反序列化：与生产端 Buffer.from(JSON.stringify(...)) 严格对称
    const data = JSON.parse(msg.content.toString());
    console.log('[es] 收到消息，写入 ElasticSearch:', data.docId, data.source);

    /**
     * 实际项目里这里会做：解析 Markdown → 建索引文档 → bulk 写入 ES。
     *
     * 注意这条链路的耗时与向量化完全独立：
     * 向量化因 embedding 慢而积压时，ES 这条队列不会受任何影响 ——
     * 两个队列的消费进度互不干扰，这是「一份数据、多路异步处理」
     * 比「接口里顺序调用两个写入」最大的优势。
     */
    channel.ack(msg);
  });
}

main().catch(console.error);
