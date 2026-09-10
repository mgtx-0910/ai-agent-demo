import { connect } from '../config.js';

const EXCHANGE = 'doc.route.headers';

/**
 * ============================================================
 * 实验四 · headers 交换机 —— 按消息属性路由
 * ============================================================
 *
 * 【行为】不看 routing key，而是看消息的 headers（一组键值对）
 * 是否满足绑定条件。
 *
 * 【何时用 headers 而不是 topic / direct】
 *   - 路由条件是多个独立属性（格式、优先级、租户、语言…），
 *     很难压成一条 routing key
 *   - 需要「同时满足多个条件」（x-match=all）或「满足任一条件」（any）
 *
 *   反面例子：想表达「pdf 且 high 或 docx」这种逻辑，topic 的 key
 *   根本无法表达（分段是位置语义，不支持布尔组合），headers 才能做。
 *
 * 【代价（选它之前请先权衡）】
 *   - 可读性差：看代码看不出路由规则，得去翻绑定参数
 *   - 匹配开销略高：Broker 要逐条比对键值对，不像 key 匹配那样简单
 *   - 各语言客户端对 headers 的支持和类型处理不完全一致
 *   能用 topic 表达清楚的，就别用 headers。
 *
 * 【匹配模式由绑定的 x-match 决定，见 consumer】
 *   all：绑定里列出的 header 必须全部匹配（默认）
 *   any：绑定里任一 header 匹配即可
 */

async function main() {
  const { connection, channel } = await connect();

  // 声明 headers 类型交换机（幂等；已存在但类型不同会报 406）
  await channel.assertExchange(EXCHANGE, 'headers', { durable: true });

  /**
   * 三条消息，靠 headers 的组合区分（业务上：不同格式 + 不同优先级）。
   *
   * 三条的组合刻意设计成「能区分 all 与 any 的差别」，
   * 对照 README 里的预期表看效果最清楚。
   *
   * 【header 值的类型限制】值必须是字符串或数字 / 布尔这类标量。
   * 传对象或数组会直接报错（AMQP 的 field table 有类型约束）。
   * 如果要表达「多值」，一般拆成多个 header 或用字符串编码。
   *
   * 【保留 header】以 x- 开头的 header 名（如 x-match、x-death）
   * 是 AMQP / RabbitMQ 自己使用的，业务自定义时避开这个前缀，
   * 否则可能和自己的路由逻辑或死信机制打架。
   */
  const messages = [
    {
      headers: { format: 'pdf', priority: 'high' },
      body: { docId: '1', note: '高优先级 PDF' },
    },
    {
      headers: { format: 'pdf', priority: 'low' },
      body: { docId: '2', note: '低优先级 PDF' },
    },
    {
      headers: { format: 'docx', priority: 'high' },
      body: { docId: '3', note: '高优先级 DOCX' },
    },
  ];

  for (const item of messages) {
    /**
     * headers 交换机下 routing key 通常传 ''（反正会被忽略）。
     *
     * 真正参与路由的是 options.headers。
     *
     * 【注意一个不对称】生产端只知道「消息带了哪些 header」，
     * 并不知道这些 header 会被哪些绑定条件命中 —— 甚至可能一条都没命中，
     * 消息被静默丢弃。所以用 headers 交换机时，管理台里
     * Exchanges → 该交换机 → Bindings 页是最重要的排查入口。
     *
     * publish 其余参数（Buffer 序列化、persistent、contentType）
     * 与 direct 一致，详见 src/direct/producer.js。
     */
    channel.publish(EXCHANGE, '', Buffer.from(JSON.stringify(item.body)), {
      persistent: true,
      contentType: 'application/json',
      headers: item.headers,
    });
    console.log('[headers producer] 发送 headers=', item.headers, 'body=', item.body);
  }

  /**
   * 等缓冲刷出去再关连接（publish 不返回 Promise）。详见 direct/producer.js。
   */
  setTimeout(async () => {
    await channel.close();
    await connection.close();
  }, 500);
}

main().catch(console.error);
