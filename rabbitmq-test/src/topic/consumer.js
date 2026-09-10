import { connect } from '../config.js';

const EXCHANGE = 'doc.event.topic';

/**
 * 绑定模式（binding key）示例，对照 producer 发出的四条消息：
 *
 *   doc.*.parsed  → 收 doc.pdf.parsed、doc.docx.parsed
 *                   （中间一段任意，末尾必须是 parsed）
 *                   不收 *.failed
 *
 *   doc.pdf.#     → 收 doc.pdf.parsed、doc.pdf.failed
 *                   （pdf 后面无论还有几段都匹配）
 *
 *   doc.#         → 收全部 doc. 开头的事件
 *
 *   #.failed      → 收所有以 failed 结尾的事件
 *
 * 【两个容易搞错的细节】
 *   1) 通配符必须「独占一段」，不能写在单词内部：
 *        doc.pdf*.parsed   ✗ 不合法（当作字面量，匹配不到任何东西）
 *        doc.*.parsed      ✓
 *   2) '#' 可以匹配「零个」单词，所以 'doc.#' 连 'doc' 本身都能匹配，
 *      而单个 '#' 会接收该交换机上的全部消息。订阅范围过大时后果是整个队列
 *      被灌满，写模式前先想清楚边界。
 */
const bindingKey = process.argv[2] || 'doc.*.parsed';

/**
 * 队列名里把通配符换成下划线，避免特殊字符带来困扰。
 *
 * 为什么要替换？'doc.*.parsed' 里的 * 和 # 在管理台的 URL、日志、
 * 命令行里都可能被 shell 或浏览器解释，做队列名不方便。
 * 替换后：doc.*.parsed → doc.topic.doc___parsed
 *
 * 注意这带来一个副作用：不同模式可能撞成同一个队列名。例如
 * 'doc.*.parsed' 和 'doc.#.parsed' → 都是 doc.topic.doc___parsed
 * （* 和 # 都被替换成了 _）。此时后启动的消费者会往同一个队列上
 * 再加一条绑定，两条绑定是「或」的关系，收到的消息会比预期多 ——
 * 排查「为什么我收多了」的时候要想到这一点。
 */
const QUEUE = `doc.topic.${bindingKey.replace(/[.#*]/g, '_')}`;

/**
 * topic 消费者：用「模式」订阅一类 routing key，而不是写死某一个。
 *
 * 【topic 最实际的收益】需求变化时只改消费者：
 *   业务方说「再加一个 pptx 格式」，生产者照旧按 doc.pptx.parsed 发，
 *   绑 doc.*.parsed 的队列自动就收到了，一行绑定代码都不用改。
 *   换成 direct 就得手动补一条绑 'doc.pptx.parsed'，且每次新增格式都要补。
 */
async function main() {
  const { channel } = await connect();

  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });

  /**
   * bindQueue(queue, exchange, bindingKey)
   *
   * 第三个参数在这里是「模式」而不是精确字符串 —— 这是 topic 与 direct
   * 在代码上唯一但本质的区别。
   * Broker 会用该模式去匹配每条消息的 routing key，命中才入队。
   *
   * 匹配动作发生在「消息到达交换机」的那一刻，之后即使改了绑定，
   * 也不会影响队列里已经堆积的消息。
   */
  await channel.bindQueue(QUEUE, EXCHANGE, bindingKey);

  console.log(`[topic] 消费者监听队列=${QUEUE}, bindingKey=${bindingKey}`);

  channel.consume(QUEUE, (msg) => {
    // 消费者被取消时可能收到 null
    if (!msg) return;

    const data = JSON.parse(msg.content.toString());

    /**
     * msg.fields.routingKey 是生产者实际发送时的 key（原始值，如 doc.pdf.parsed），
     * 把它和本队列的绑定模式一起打印，可以直观验证「模式是否按预期命中」：
     *
     *   routingKey=doc.pdf.parsed,  binding=doc.*.parsed   → 符合预期
     *   routingKey=doc.pdf.failed,  binding=doc.*.parsed   → 不该出现，说明绑定写错了
     *
     * 这类「把事实和规则放一起打印」的做法，比事后去管理台翻绑定高效得多，
     * 推荐在所有订阅类代码里保留。
     */
    console.log(
      `[topic] routingKey=${msg.fields.routingKey}, binding=${bindingKey}, 内容:`,
      data,
    );
    channel.ack(msg);
  });
}

main().catch(console.error);
