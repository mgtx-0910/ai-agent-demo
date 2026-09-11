# rabbitmq-test —— RabbitMQ 四种交换机（Exchange）实战

用 `amqplib` 把 RabbitMQ 的 **direct / fanout / topic / headers** 四种交换机各跑一遍。

四个实验共用同一套业务设定（**文档解析流水线**），这样差异只来自「路由方式」本身，方便横向对比。

![RabbitMQ 工作原理](RabbitMq工作原理.jpg)

*RabbitMQ 工作原理示意图*

## 一句话看懂四种交换机

| 交换机 | 靠什么路由 | 路由规则 | 本示例场景 |
|---|---|---|---|
| `direct` | routing key **完全相等** | 精确匹配 | 按 `info` / `warning` / `error` 分发任务通知 |
| `fanout` | **不看 routing key** | 广播到所有绑定队列 | 一份 Markdown 同时喂给向量化和 ES |
| `topic` | routing key 按 `.` 分段 + 通配符 | 模式匹配一类事件 | 只订阅所有 `*.parsed` |
| `headers` | 消息的 **headers 键值对** | 多属性组合（`all` / `any`） | `format=pdf` **且** `priority=high` |

路由能力的包含关系：`fanout` ⊂ `direct` ⊂ `topic` —— topic 已是 routing key 维度上最强的。
`headers` 是另一个维度：它**完全忽略 routing key**，改看消息属性，适合「路由条件压不成一条 key」的场景（格式 + 优先级 + 租户…）。

## 目录结构

```
rabbitmq-test/
├── src/
│   ├── config.js                  # 连接 Connection + 开 Channel（含密码 URL 编码说明）
│   ├── direct/
│   │   ├── producer.js            # 发 info / warning / error 三条消息
│   │   └── consumer.js            # 绑某个 key，只收该级别
│   ├── fanout/
│   │   ├── producer.js            # 解析完成 → 广播一份 Markdown
│   │   ├── consumer-vector.js     # 队列 doc.vectorize      （模拟写 Milvus）
│   │   └── consumer-es.js         # 队列 doc.elasticsearch  （模拟写 ES）
│   ├── topic/
│   │   ├── producer.js            # 发 doc.<格式>.<事件> 四条
│   │   └── consumer.js            # 用通配符模式订阅
│   └── headers/
│       ├── producer.js            # 发 (pdf,high) / (pdf,low) / (docx,high)
│       └── consumer.js            # x-match=all|any + 若干 header 条件
├── RabbitMq工作原理.jpg           # RabbitMQ 工作原理示意图（学习笔记配图）
├── docker-compose.yml             # RabbitMQ 3.13（带管理台）
└── package.json                   # amqplib 2.x + npm run 脚本
```

## 快速开始

### 1. 启动 RabbitMQ

```bash
cd rabbitmq-test
docker compose up -d
```

| | |
|---|---|
| AMQP 地址 | `localhost:5672` |
| 管理台 | http://localhost:15672 |
| 账号 / 密码 | `admin` / `Admin@123456` |
| 数据目录 | `./rabbitmq_data`（挂载到容器 `/var/lib/rabbitmq`） |

> 管理台是学 RabbitMQ 的「透视眼」：每跑完一个实验，都去 **Exchanges / Queues** 页看一眼是谁绑了谁、消息被投到了哪，比只看控制台输出直观得多。

### 2. 安装依赖

```bash
npm install
```

### 3. 运行方式

```bash
npm run <脚本名>            # 推荐，脚本名见下表
node src/<目录>/<文件>.js   # 等价写法
```

| npm 命令 | 等价于 |
|---|---|
| `npm run direct:producer` | `node src/direct/producer.js` |
| `npm run direct:consumer` | `node src/direct/consumer.js` |
| `npm run fanout:producer` | `node src/fanout/producer.js` |
| `npm run fanout:consumer:vector` | `node src/fanout/consumer-vector.js` |
| `npm run fanout:consumer:es` | `node src/fanout/consumer-es.js` |
| `npm run topic:producer` | `node src/topic/producer.js` |
| `npm run topic:consumer` | `node src/topic/consumer.js` |
| `npm run headers:producer` | `node src/headers/producer.js` |
| `npm run headers:consumer` | `node src/headers/consumer.js` |

### ⚠️ 顺序：先起消费者，再起生产者

这是初学 RabbitMQ 最容易踩的坑：**消息只会进「已存在且已绑定」的队列**。

- 队列不存在 / 没有绑定到这个 Exchange → Broker 收到消息后**直接丢弃**，不报错、不排队；
- 队列存在但没消费者 → 消息会**堆在队列里**等消费，不会丢。

所以每个实验建议**开两个终端**：一个常驻跑消费者（Ctrl+C 退出），另一个跑生产者。
（后续重复实验时，因为队列已经建好了，即使消费者没开，消息也会留在队列里等下次消费 —— 这就是「第一次必须按顺序」的原因。）

## 实验一：direct —— 精确匹配

```
                    routing key 必须完全相等
producer ──► Exchange(doc.task.direct, direct)
                    │  info     │  warning   │  error
                    ▼           ▼            ▼
              doc.task.info  doc.task.warning  doc.task.error
```

**消费者**（第三个参数是绑定 key，不传默认 `info`）：

```bash
npm run direct:consumer -- info      # 终端 1
npm run direct:consumer -- error     # 终端 2（可选，再开一个）
```

**生产者**：

```bash
npm run direct:producer
```

**预期**：绑 `info` 的终端只出现 `info` 那条，`error` 只出现在绑 `error` 的终端。
关键在于：**binding key 与 routing key 一个字都不能差**，绑 `info` 的队列永远收不到 `error` 的消息。

## 实验二：fanout —— 广播

```
                              ┌──► Queue doc.vectorize      ──► 模拟写入 Milvus
producer ──► Exchange(doc.parse.fanout, fanout)
                              └──► Queue doc.elasticsearch ──► 模拟写入 ES
```

**消费者**（两个，各占一个终端）：

```bash
npm run fanout:consumer:vector    # 终端 1
npm run fanout:consumer:es        # 终端 2
```

**生产者**：

```bash
npm run fanout:producer
```

**预期**：两个终端**同时**打印出同一个 `docId`。

这就是 RAG 场景里的典型用法：解析接口产出 Markdown 后只发一次消息，向量化和 ES 两条链路各自异步消费，接口不必同步等待两个耗时写入。
两个队列互不影响消费进度（`doc.vectorize` 慢了不会拖住 `doc.elasticsearch`），这是「同一份数据、多路异步处理」最省事的实现方式。

> fanout 下 `publish` 的 routing key 会被忽略，习惯上传空字符串 `''`。

## 实验三：topic —— 模式匹配

```
routing key:  doc  .  pdf  .  parsed
              └业务域┘ └格式┘ └事件类型┘

producer 发送：
  doc.pdf.parsed    doc.docx.parsed    doc.pptx.failed    doc.pdf.failed
```

**通配符规则**：

| 通配符 | 含义 | 例子 |
|---|---|---|
| `*` | 恰好匹配**一个**单词（不跨段） | `doc.*.parsed` → 命中 `doc.pdf.parsed`、`doc.docx.parsed` |
| `#` | 匹配**零个或多个**单词（可跨段） | `doc.pdf.#` → 命中 `doc.pdf.parsed`、`doc.pdf.failed` |

**消费者**（第二个参数是绑定模式）：

```bash
npm run topic:consumer                      # 默认 doc.*.parsed
npm run topic:consumer -- "doc.#"           # 全部 doc. 事件
npm run topic:consumer -- "#.failed"        # 所有失败事件
npm run topic:consumer -- "doc.pdf.#"       # 只要 pdf 的
```

**生产者**：

```bash
npm run topic:producer
```

**预期**：绑 `doc.*.parsed` 的只收到 `doc.pdf.parsed` 和 `doc.docx.parsed`，两条 `*.failed` 收不到。

要点：**通配符写在消费者的 binding key 上，生产者永远发具体的 routing key**。这正是 topic 比 direct 强的地方 —— 生产者照常发精确 key，消费者侧可以自由组合订阅粒度，新增消费方不需要改生产者。

> 队列名由绑定模式里的 `.` `#` `*` 替换成下划线生成（如 `doc.*.parsed` → `doc.topic.doc___parsed`），避免特殊字符在管理台里带来困扰。

## 实验四：headers —— 按属性路由

```
producer 发送三条：
  { format: pdf,  priority: high }
  { format: pdf,  priority: low  }
  { format: docx, priority: high }

绑定条件决定收哪几条
```

headers 交换机的绑定条件是**一组键值对**，由 `x-match` 决定组合逻辑：

| `x-match` | 含义 |
|---|---|
| `all` | 绑定里列出的 header **全部**匹配才算命中（默认） |
| `any` | 绑定里**任一** header 匹配即命中 |

**消费者**（参数依次为 `matchMode format priority`）：

```bash
npm run headers:consumer                          # 默认 all / pdf / high
npm run headers:consumer -- all pdf high          # 同上，只收高优先级 PDF
npm run headers:consumer -- any pdf none          # 只要 format 是 pdf 就收
```

**生产者**：

```bash
npm run headers:producer
```

**预期对照**：

| 绑定条件 | 命中消息 |
|---|---|
| `all` + `pdf` + `high` | 仅第 1 条 |
| `all` + `pdf`（priority 传 `none`） | 第 1、2 条 |
| `any` + `pdf` + `high` | **三条全中**（pdf 或 high，任一成立） |
| `any` + `pdf` + `none` | 第 1、2 条 |

> 注意 `any pdf` 这个写法：因为脚本里 `priority` 不传时默认是 `high`，而 `any` 是「任一成立」，所以 `any pdf high` 会把 `docx+high` 也收进来。**只想按 format 筛，要把 priority 显式传成一个不存在的值**（如 `none`）来关掉这个条件。

**什么时候用 headers 而不是 topic**：当路由条件是**多个彼此独立的属性**（格式、优先级、租户、语言…），压成一条 routing key 会很别扭或根本组合不完时。代价是 headers 的可读性差、匹配开销略高，能用 topic 表达就别用 headers。

## 概念速查

- **Connection vs Channel**：Connection 是客户端与 Broker 之间的 **TCP 连接**（建一次开销大，要复用）；Channel 是连接上的**逻辑通道**，声明交换机/队列、收发消息都走 Channel。多路复用一条 TCP，是 AMQP 的核心设计。见 `src/config.js`。
- **routing key vs binding key**：生产者 `publish` 时带的是 **routing key**；消费者 `bindQueue` 时带的是 **binding key**（对 topic 来说是「模式」）。交换机拿前者去匹配后者的规则。
- **`durable` vs `persistent`**：`durable: true` 是**队列/交换机的定义**持久化（Broker 重启后还在）；`persistent: true` 是**单条消息**落盘。两者要配合使用，且严格不丢还需要发布确认、仲裁队列等，本示例只演示基本用法。
- **`ack` 手动确认**：`channel.consume` 默认不自动确认，处理成功后再 `channel.ack(msg)`；进程崩溃时未 ack 的消息会重新投递，避免任务丢失（失败可 `nack` / `reject` 决定是否重回队列）。
- **`publish` 不返回 Promise**：它是「写进本地缓冲就返回」，所以生产者脚本最后用 `setTimeout(..., 500)` 留点时间把缓冲刷出去再关连接，否则可能消息还没发完连接就断了。
- **密码里的特殊字符要 URL 编码**：连接串格式 `amqp://用户:密码@主机:端口/vhost`，默认密码 `Admin@123456` 里的 `@` 必须写成 `%40`，否则解析器会把 `@123456@localhost` 拆错。见 `src/config.js`。
- **改连接地址**：`src/config.js` 读 `process.env.RABBITMQ_URL`，优先于默认值。项目**没有引入 dotenv**，所以要用环境变量方式传入：
  ```powershell
  $env:RABBITMQ_URL = "amqp://guest:guest@localhost:5672"; npm run direct:producer
  ```

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| `ECONNREFUSED 127.0.0.1:5672` | RabbitMQ 没启动：先 `docker compose up -d`，再看管理台能否打开 |
| 生产者显示发送成功，消费者什么都没收到 | 消息在**没有绑定队列**时被直接丢弃。先起消费者把队列建出来，再跑生产者；或去管理台确认 Exchange 上有没有绑定 |
| 绑定了却仍收不到 | binding key 写错（direct 必须完全相等；topic 通配符位置不对）。管理台 Exchanges → 该交换机 → Bindings 页可核对 |
| 消费者跑着跑着不动了 | 正常，`consume` 是常驻监听，等消息而已；Ctrl+C 退出 |
| `ACCESS_REFUSED` / 登录失败 | 账号密码不对；确认用的是 `admin` / `Admin@123456`，且连接串里 `@` 已编码为 `%40` |
| `node` / `npm` 命令找不到 | 本机 Node 由 fnm 管理且未激活。仓库根目录有 `.node-version`（当前 `24.18.0`），根目录的 `node-npm.ps1` / `node-fnm.ps1` 是给调试器用的启动包装脚本 |
| 想彻底重来 | `docker compose down` 后删掉 `./rabbitmq_data` 再 `up -d`，或直接在管理台删掉相关 Queue / Exchange（注意 Exchange 要先解绑再删） |

## 备注

- **依赖**：`amqplib@^2.0.1`（Promise API 为默认入口 `amqplib`，Callback API 移到了 `amqplib/callback_api`）；要求 Node.js >= 18，本仓库使用 24.18.0。代码里的 `import amqp from 'amqplib'` + `await amqp.connect(...)` 就是 Promise 风格。
- **数据目录**：`docker-compose.yml` 把数据挂到了 `./rabbitmq_data`，**该目录尚未写入 `.gitignore`**，首次 `up -d` 后会生成，提交前建议补一行忽略规则。
- **模型无关**：`admin` / `Admin@123456` 是为了本地演示方便写死在 compose 与 `config.js` 里的，真实环境请改用环境变量或密钥管理，并给账号分配最小权限的 vhost。
- **阅读顺序建议**：先看 `src/config.js` 理解 Connection / Channel，再按 `fanout → direct → topic → headers` 顺序跑（从「最不看条件」到「最看条件」，理解成本递增）。
- 脚本内均带逐行教学注释，解释了每个参数与「为什么这么写」，遇到疑问可直接对照源码。
