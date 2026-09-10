import { connect } from '../config.js';

const EXCHANGE = 'doc.route.headers';

/**
 * 命令行参数（注意 npm 传参要用 `--` 分隔，详见 src/direct/consumer.js）：
 *   argv[2]  matchMode  all | any，不传默认 all
 *   argv[3]  format     如 pdf / docx，不传默认 pdf
 *   argv[4]  priority   如 high / low，不传默认 high
 *
 * all + pdf + high → 要求 format、priority 都匹配，只收「高优先级 PDF」
 * any + pdf + high → format 或 priority 任一命中即可
 *
 * 【⚠ any 模式的陷阱】因为 priority 不传时默认是 'high'，
 * 「只是想按 format 筛」的人很容易写成 any + pdf（priority 偷偷变成 high），
 * 结果 docx+high 也被收进来 —— 因为它的 priority 命中了条件。
 * 想关掉某个条件，要显式传一个消息里不存在的值，例如：any pdf none
 */
const matchMode = process.argv[2] || 'all';
const format = process.argv[3] || 'pdf';
const priority = process.argv[4] || 'high';

/**
 * 队列名按「模式 + 条件」拼出来，让每个不同条件的消费者各自一个队列，
 * 在管理台里能一眼分辨谁在等什么。
 *
 * priority 为空时不拼这一段，避免出现 doc.headers.all.pdf. 这种带尾巴的名字。
 */
const QUEUE = `doc.headers.${matchMode}.${format}${priority ? '.' + priority : ''}`;

/**
 * headers 消费者：用 bind 时的 arguments 描述「我关心哪些 header」。
 *
 * 【和另外三种交换机的根本区别】
 *   direct / fanout / topic 的路由规则都写在 bindQueue 的第三个参数（key）上；
 *   headers 的规则写在第四个参数（arguments）里，第三个参数传空。
 *   所以「这个队列为什么收不到消息」在 headers 下要先看 arguments。
 *
 * 【注意事项】
 *   - x-match 本身不参与和消息 header 的值比较，它只是告诉 Broker 用 all 还是 any
 *   - x-match 的值必须是字符串 'all' / 'any'（不是布尔）
 *   - 除 x-match 外的键值对才是真正的匹配条件，且「值也要相等」才算命中
 */
async function main() {
  const { channel } = await connect();

  await channel.assertExchange(EXCHANGE, 'headers', { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });

  /** 绑定参数：x-match + 若干业务 header */
  const bindArgs = {
    'x-match': matchMode, // 'all' 全部匹配；'any' 任一匹配
    format,
  };
  /**
   * priority 只有在显式传入时才加入条件：
   * 这样 `npm run headers:consumer -- all pdf` 就能表达
   * 「所有 pdf，不管优先级」，而不必去猜一个「万能值」。
   * （注意：跳过条件靠的是「不写这个键」，而不是把值写成 '*' ——
   *   headers 匹配是值相等，没有通配符语法。）
   */
  if (priority) {
    bindArgs.priority = priority;
  }

  /**
   * bindQueue(queue, exchange, routingKey, arguments)
   * headers 模式下第四个 arguments 才是路由规则本体。
   * 第三个参数传 ''，传别的也不会参与路由。
   *
   * 【绑定是叠加的】同一个队列可以绑多条。
   * 若用同一个队列名反复以不同 bindArgs 启动，绑定会累加，
   * 命中「任一条」即入队 —— 表现为收到的消息比预期多。
   * 想比较不同条件，请用不同队列名（本脚本通过队列名拼接规避了这一点）。
   */
  await channel.bindQueue(QUEUE, EXCHANGE, '', bindArgs);

  console.log(`[headers] 消费者监听队列=${QUEUE}, 匹配条件=`, bindArgs);

  channel.consume(QUEUE, (msg) => {
    if (!msg) return;

    const data = JSON.parse(msg.content.toString());

    /**
     * msg.properties.headers 是生产端 publish 时带的 headers，
     * 打印出来对照本队列的绑定条件，可以直观看出「为什么这条会被收进来」。
     * 例如 any 模式下 docx+high 也被收，看一眼 headers 和 matchMode 就明白了。
     */
    console.log('[headers] 收到 headers=', msg.properties.headers, 'body=', data);
    channel.ack(msg);
  });
}

main().catch(console.error);
