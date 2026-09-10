import { connect } from '../config.js';

const EXCHANGE = 'doc.event.topic';

/**
 * ============================================================
 * 实验三 · topic 交换机 —— 模式匹配
 * ============================================================
 *
 * 【行为】routing key 按「.」分成若干单词，绑定端可用通配符做模式匹配。
 *
 * 【通配符规则】
 *   *  → 恰好匹配一个单词（不能跨段）
 *   #  → 匹配零个或多个单词（可跨段）
 *
 * 【示例 routing key 的分段设计】
 *   doc.pdf.parsed
 *   │   │    └── 事件类型
 *   │   └─────── 文档格式
 *   └─────────── 业务域
 *
 *   分段的设计是有讲究的：把「变化维度」按从稳定到易变的顺序排，
 *   消费端才能写出有意义的模式。比如要「所有格式的解析完成事件」，
 *   就必须让「格式」恰好占中间一段 → doc.*.parsed。
 *   如果随机拼接，通配符就无从落脚。
 *
 * 【对比 direct】
 *   - direct：必须整串完全相等，加一个新格式就要新增一条绑定
 *   - topic：可用模式一次订阅一类消息（如所有 *.parsed），无需随格式增长而改
 *
 * 【生产者视角】注意：生产者只发「具体」key，永远不发通配符。
 *   通配符是消费端 binding key 的语法 —— 这个分工是理解 topic 的关键。
 */

async function main() {
  const { connection, channel } = await connect();

  // 声明 topic 类型交换机（幂等；已存在但类型不同会报 406）
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

  /**
   * 四条事件，模拟文档处理流水线的产出。
   *
   * 刻意包含两类事件（parsed / failed）× 三种格式（pdf / docx / pptx），
   * 这样消费端用不同模式订阅时，命中结果的差异才看得清楚：
   *   doc.*.parsed   → 前两条
   *   #.failed       → 后两条
   *   doc.pdf.#      → 第 1、4 条
   */
  const events = [
    { routingKey: 'doc.pdf.parsed', body: { type: 'parsed', format: 'pdf' } },
    { routingKey: 'doc.docx.parsed', body: { type: 'parsed', format: 'docx' } },
    { routingKey: 'doc.pptx.failed', body: { type: 'failed', format: 'pptx' } },
    { routingKey: 'doc.pdf.failed', body: { type: 'failed', format: 'pdf' } },
  ];

  for (const event of events) {
    /**
     * 发布时写「具体」的 routing key（一般不用通配符）。
     * 通配符是给消费者 bindQueue 时用的。
     *
     * 【为什么生产者发了通配符也不会报错？】
     *   因为 key 只是字符串，Broker 不认识「通配符」这个概念 ——
     *   它只是拿消息的 key 去和每条绑定的模式做匹配。
     *   如果生产者真发 'doc.*.parsed' 这个字面量，那么：
     *     - 绑 'doc.*.parsed' 的队列收不到（* 匹配不了字面量 '*'）
     *     - 反而会被 'doc.#' 这类模式意外收走
     *   也就是说，写错了不报错但结果错 —— 排查时先用管理台看实际绑定。
     *
     * 【publish 四个参数的完整说明见 src/direct/producer.js】，
     * 这里只强调本实验特有的部分：routingKey 必须是点分格式。
     */
    channel.publish(
      EXCHANGE,
      event.routingKey,
      Buffer.from(JSON.stringify(event.body)),
      { persistent: true, contentType: 'application/json' },
    );
    console.log(`[topic producer] 发送 routingKey=${event.routingKey}:`, event.body);
  }

  /**
   * 等缓冲刷出去再关连接（publish 不返回 Promise，详见 direct/producer.js 的说明）。
   * 不显式 close 的话，TCP 连接会让 Node 进程一直挂着不退出。
   */
  setTimeout(async () => {
    await channel.close();
    await connection.close();
  }, 500);
}

main().catch(console.error);
