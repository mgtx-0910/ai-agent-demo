import { connect } from '../config.js';

/**
 * ============================================================
 * 实验一 · direct 交换机 —— 精确匹配
 * ============================================================
 *
 * 【业务场景】文档解析流水线要把任务通知发给「通知系统」，
 * info / warning / error 三个级别由不同下游处理，互不干扰 —— 这正是
 * direct 的典型用途：按 routing key 精确分流。
 *
 * 【direct 的行为，一句话】
 * 消息的 routing key 必须与队列的 binding key「逐字符完全相等」才会投递。
 *
 * 【和 fanout 的区别】
 *   fanout  所有绑定队列都收，key 被忽略   → 广播
 *   direct  key 对得上的队列才收            → 单播 / 按 key 分组
 *
 * 【常被忽略的能力】direct 也支持「一对多」：多个队列绑同一个 key，
 * 消息会复制给它们全部。所以 fanout 可以看作「所有队列都绑了同一个
 * 空 key」的 direct 特例。
 */

/**
 * 交换机名称。
 *
 * 命名习惯：用点分层（doc.task.direct）而不是 exchange1，
 * 这样在管理台一眼看出业务域（doc）+ 用途（task）。
 * 名字里带类型（direct）只是本项目的实验约定，真实项目按业务命名即可。
 */
const EXCHANGE = 'doc.task.direct';

async function main() {
  /**
   * 取连接层的产物。
   *
   * 这里要同时拿到 connection，是因为生产者发完消息必须关连接；
   * 只解构 channel 就没法优雅退出了（进程会一直挂着不结束）。
   *
   * 【为什么生产者也要连 Broker？】
   *   publish 的语义是「把消息交给 Broker」，生产者与消费者之间
   *   没有任何直接通信 —— 它甚至不知道有没有消费者存在。
   *   这种「互不知道对方」正是消息队列解耦的本质。
   */
  const { connection, channel } = await connect();

  /**
   * assertExchange(exchange, type, options)
   *
   * 「assert」是 AMQP 的惯用语，含义是「确保存在」：
   *   - 交换机不存在 → 按给定参数创建
   *   - 已存在       → 校验 type 是否一致（不一致会报 406 并关闭 channel）
   * 所以它是幂等的，脚本反复运行不会重复创建。
   *
   *   'direct'       路由类型，决定 key 的匹配规则
   *   durable: true  交换机的「定义」落盘，Broker 重启后交换机仍存在。
   *                  注意它只管定义，消息是否落盘要看 publish 时的 persistent。
   *
   * 【两端都声明会不会重复？】不会。好处是顺序无关且更健壮：
   * 无论先跑生产者还是消费者，都不会因「交换机不存在」而失败。
   * 真实项目通常由运维或初始化脚本统一声明，业务代码只管收发。
   */
  await channel.assertExchange(EXCHANGE, 'direct', { durable: true });

  /**
   * 三条消息，各带不同的 routing key。
   *
   * body 是业务载荷。要注意：
   *   RabbitMQ 对消息体完全「不透明」—— 它不看也不解析内容，只当字节搬运。
   *   所以序列化格式（JSON / Protobuf / 纯文本）由收发双方自己约定。
   *   这既是解耦的前提，也是它的代价：两端格式必须一致，否则消费端解析报错。
   */
  const tasks = [
    { routingKey: 'info', body: { level: 'info', text: '文档解析完成' } },
    { routingKey: 'warning', body: { level: 'warning', text: '文档页数过多，耗时较长' } },
    { routingKey: 'error', body: { level: 'error', text: 'OCR 识别失败' } },
  ];

  for (const task of tasks) {
    /**
     * publish(exchange, routingKey, content, options)
     *           ↑         ↑          ↑        ↑
     *          交换机      路由键     消息体    消息属性
     *
     * 1) 第一个参数是「交换机」而不是队列名 —— 这是 AMQP 最重要的设计：
     *    生产者从不直接往队列发消息，只把消息交给交换机，由交换机 + 绑定关系
     *    决定最终落到哪些队列。生产者因此不需要知道下游有几个队列、叫什么。
     *    （若确实要直投队列，可传空字符串走默认交换机、routingKey 写队列名，
     *      但这会把队列名硬编码进生产者，通常不建议。）
     *
     * 2) routingKey：Exchange 拿它去和各队列的 binding key 比对。
     *    这里发的是「具体值」，通配符只能出现在消费端的绑定上。
     *
     * 3) content 必须是 Buffer：AMQP 协议层面搬的是字节串，不是 JS 对象。
     *    这里 JSON.stringify 转字符串、Buffer.from 转字节；
     *    消费端会做严格对称的反向操作 JSON.parse(msg.content.toString())。
     *    任意一端漏掉这一步，就会得到 "[object Object]" 或解析报错。
     *
     * 4) options：
     *    persistent: true              消息标记为持久化（写磁盘）。必须配合
     *                                  durable 队列才有意义 —— 队列本身不是
     *                                  durable 的话，重启后队列都没了，消息自然也丢。
     *                                  两者都开仍有一个「已接收但未落盘」的极短窗口，
     *                                  严格不丢需要发布确认，见下文。
     *    contentType: 'application/json'
     *                                  纯元数据，RabbitMQ 不解析，但消费端、
     *                                  管理台、其他语言客户端可据此选择反序列化方式。
     *                                  属于约定而非强制，建议始终带上。
     *
     * 【重要】publish 没有返回值，也不返回 Promise：
     * 它只是「写进客户端本地缓冲」就立刻返回，真正发网络是异步的。
     * 所以既不能 await 它，也不能认为这行执行完消息就一定到了 Broker。
     * 需要确认送达要用 confirm channel（connection.createConfirmChannel()
     * + await channel.waitForConfirms()）。
     */
    channel.publish(
      EXCHANGE,
      task.routingKey,
      Buffer.from(JSON.stringify(task.body)),
      { persistent: true, contentType: 'application/json' },
    );
    console.log(`[direct producer] 发送 routingKey=${task.routingKey}:`, task.body);
  }

  /**
   * 【为什么要 setTimeout 再关？】
   *
   * 承上：publish 只写本地缓冲，若这行之后立刻 close，
   * 缓冲里还没发出去的消息会随连接一起消失 —— 表现就是
   * 「生产者说发送成功，消费者却什么都没收到」，非常难排查。
   *
   * 500ms 是「给缓冲一点时间刷出去」的经验值，教学脚本够用。
   * 更严谨的两种做法：
   *   1) Confirm 模式：Broker 明确回执后再关闭，可确定消息已抵达
   *   2) 监听连接的 'drain' 事件，确认缓冲已清空
   *
   * 另外：这里必须显式 close()，否则 Connection 上还挂着 TCP，
   * Node 进程不会自动退出（脚本会卡住不结束）。
   */
  setTimeout(async () => {
    await channel.close(); // 先关通道更优雅，再关连接
    await connection.close();
  }, 500);
}

/**
 * main() 返回的是 Promise，用 catch 统一接住异常。
 * 没有这行的话，异步函数里抛错只会产生 unhandledRejection 警告，
 * 进程还会以退出码 0 结束 —— 表现为「看起来跑成功了」其实失败了，
 * 排查起来很费时间。
 */
main().catch(console.error);
