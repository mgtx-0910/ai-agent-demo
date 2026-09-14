# hello-nest-langchain

**NestJS + LangChain** 集成入门示例：演示如何在标准 NestJS 工程里接入 LangChain 构建 AI 对话接口（一次性 + SSE 流式），
同时保留一套 Nest CLI 生成的 CRUD 模块作为「分层架构 / 依赖注入」的对照参考。

这个项目回答两个问题：

| 问题 | 答案所在 | 关键文件 |
| --- | --- | --- |
| LangChain 的链怎么"塞进" Nest 的依赖注入体系？ | AI 模块 | `src/ai/*` |
| 一个 Nest 项目的标准分层长什么样、各层职责如何切分？ | 图书模块 | `src/book/*` |

> 它**不是**一个可用的 AI 产品：没有鉴权、没有持久化、没有对话历史。
> 它的定位是「把 NestJS 与 LangChain 拼起来的最小可运行骨架」，所有业务实现都刻意保持简单，便于逐个文件读懂。

## 功能一览

- **AI 对话模块（`src/ai/`）**：用 `prompt.pipe(model).pipe(parser)` 构建 Runnable 链
  - `GET /ai/chat?query=...`：等待模型回答完整生成后一次性返回 JSON
  - `GET /ai/chat/stream?query=...`：SSE 流式逐字返回（打字机效果）
- **图书管理模块（`src/book/`）**：`Controller → Service → Repository` 三层
  - 标准 RESTful 路由（`POST / GET / GET :id / PATCH :id / DELETE :id`）
  - 用自定义 Provider（`BOOK_REPOSITORY`）注入内存仓库，演示「数据源可替换」
- **依赖注入示范**：`useFactory` + `inject` 从 `.env` 读配置创建 `ChatOpenAI`，以字符串令牌 `CHAT_MODEL` 注入
- **Swagger / OpenAPI**：内置在线文档 `/api-docs`，并提供 `generate:openapi` 脚本导出 `openapi.json`
- **静态页托管**：`public/sse-test.html` 是一个开箱可用的 SSE 调试页面
- **测试样例**：单元测试（`src/app.controller.spec.ts`）+ e2e 测试（`test/app.e2e-spec.ts`）

## 目录结构

```
hello-nest-langchain/
├── .env.example                 # 环境变量示例（复制为 .env）
├── .gitignore                   # 已忽略 .env / dist / node_modules
├── nest-cli.json                # CLI 配置：Swagger 插件（自动生成接口元数据）
├── openapi.json                  # generate:openapi 生成的接口文档
├── package.json                  # 脚本、依赖
├── public/
│   └── sse-test.html            # SSE 流式接口的网页测试工具
├── src/
│   ├── main.ts                  # 启动入口：创建应用 + 装配 Swagger + listen(PORT ?? 3000)
│   ├── app.module.ts            # 根模块：聚合 ConfigModule / ServeStaticModule / 业务模块
│   ├── app.controller.ts        # GET /  → "Hello World!"
│   ├── app.service.ts           # 根服务（示例方法）
│   ├── app.controller.spec.ts   # 根控制器单元测试
│   ├── generate-openapi.ts      # 独立脚本：把接口文档写成 openapi.json
│   ├── ai/                      # AI 对话模块
│   │   ├── ai.module.ts         #   CHAT_MODEL 自定义 Provider（工厂函数读 .env）
│   │   ├── ai.controller.ts     #   GET /ai/chat、GET /ai/chat/stream（@Sse）
│   │   └── ai.service.ts        #   Runnable 链（invoke / stream）
│   └── book/                    # 图书 CRUD 模块
│       ├── book.module.ts       #   BOOK_REPOSITORY 自定义 Provider（内存仓库）
│       ├── book.controller.ts   #   RESTful 路由 + Swagger 注解
│       ├── book.service.ts      #   业务逻辑层
│       ├── dto/                 #   CreateBookDto / UpdateBookDto（请求体结构）
│       └── entities/            #   Book 实体（占位）
└── test/
    └── app.e2e-spec.ts          # e2e 测试：GET / 返回 Hello World!
```

各文件职责与关键点：

| 文件 | 是什么 | 关键点 |
| --- | --- | --- |
| `main.ts` | 应用引导 | `NestFactory.create(AppModule)` 完成 DI 装配；Swagger 挂在 `api-docs`；端口取 `process.env.PORT ?? 3000` |
| `app.module.ts` | 根模块 | `ConfigModule.forRoot({ isGlobal: true })` 让 `ConfigService` 全局可注入；`ServeStaticModule` 托管 `public/` |
| `ai.module.ts` | AI 模块 | 用 `useFactory` 把「读配置 + new ChatOpenAI」集中到模块层 |
| `ai.service.ts` | AI 业务 | 只关心"链怎么组、怎么调"，不关心模型从哪来 |
| `book.module.ts` | 图书模块 | `useFactory` 返回内存仓库；真实项目在此替换为 ORM Repository |
| `generate-openapi.ts` | 工具脚本 | `logger: false` 静默启动 → 生成文档 → `app.close()`，不占端口 |

## 请求全链路

**一次性对话：**

```
浏览器 / curl
  │  GET /ai/chat?query=什么是 LangChain
  ▼
AiController.chat()                  @Query('query') 取出查询参数
  ▼
AiService.runChain(query)            chain.invoke({ query })
  ▼
PromptTemplate        模板 "请回答以下问题：\n\n{query}" → 填充为完整提示词
  ▼
ChatOpenAI            调用 OpenAI 兼容接口（DashScope / 官方 / 自建网关）
  ▼
StringOutputParser    AIMessageChunk → 纯文本字符串
  ▼
return { answer }     Nest 自动序列化为 application/json
```

**流式对话：**

```
GET /ai/chat/stream?query=...
  ▼
AiController.chatStream()            @Sse('chat/stream') 声明 SSE 端点
  ▼
AiService.streamChain(query)         chain.stream({ query }) → AsyncGenerator<string>
  ▼
from(generator)                      AsyncGenerator → RxJS Observable
  ▼
map(chunk => ({ data: chunk }))      SDK 的每个文本块 → SSE 协议要求的 { data }
  ▼
浏览器 EventSource.onmessage         逐块拼接 → 打字机效果
```

两条链路共用同一个 `chain` 实例，区别只在结尾：`invoke()` 等全部生成完，`stream()` 边走边吐。

## AI 模块详解

### 1. 链的组装：三段式 pipe

```ts
// src/ai/ai.service.ts
this.chain = prompt.pipe(model).pipe(new StringOutputParser());
```

`.pipe()` 类似 Unix 管道，把组件串成一条 `Runnable` 链，数据单向流动：

| 环节 | 组件 | 输入 → 输出 |
| --- | --- | --- |
| ① | `PromptTemplate.fromTemplate('请回答以下问题：\n\n{query}')` | `{ query }` → 完整提示词字符串 |
| ② | `ChatOpenAI` | 提示词 → `AIMessageChunk`（含 content、token 用量等） |
| ③ | `StringOutputParser` | `AIMessageChunk` → `string`（只取 content） |

链的类型签名是 `Runnable<{ query: string }, string>`：**输入是一个带 `query` 字段的对象**，
所以调用时必须写成 `chain.invoke({ query })`，而不是 `chain.invoke(query)`——这是最常见的报错来源。
`PromptTemplate` 里的 `{query}` 就是占位符名，与对象的 key 必须一一对应。

### 2. 模型从哪来：自定义 Provider（`CHAT_MODEL`）

`AiService` 里**没有** `new ChatOpenAI(...)`，模型是通过字符串令牌注入的：

```ts
// src/ai/ai.module.ts
{
  provide: 'CHAT_MODEL',
  useFactory: (configService: ConfigService) => {
    const modelName = configService.get<string>('MODEL_NAME') ?? 'gpt-4o-mini';
    const apiKey = configService.get<string>('OPENAI_API_KEY') ?? '';
    const baseURL = configService.get<string>('OPENAI_BASE_URL');
    return new ChatOpenAI({ model: modelName, apiKey, configuration: { baseURL } });
  },
  inject: [ConfigService],
}
```

```ts
// src/ai/ai.service.ts
constructor(@Inject('CHAT_MODEL') model: ChatOpenAI) { ... }
```

拆解三个字段：

| 字段 | 作用 |
| --- | --- |
| `provide` | 注入令牌。用字符串时，消费方必须写 `@Inject('CHAT_MODEL')`；若 `provide: ChatOpenAI`（用类作令牌）则可省略 `@Inject` |
| `useFactory` | 工厂函数，决定实例怎么造。适合「创建过程需要配置 / 需要异步」的场景 |
| `inject` | 声明工厂函数的参数依赖，Nest 先解析这些依赖再调用工厂 |

**为什么不在 Service 里直接 `new`？** 三个收益：

1. 配置读取集中在模块层，Service 不碰 `.env`
2. 测试时可用 `{ provide: 'CHAT_MODEL', useValue: fakeModel }` 一行替换（不需要真实 API Key）
3. 符合依赖倒置：Service 依赖抽象的「一个 ChatOpenAI 实例」，而不是创建过程

### 3. 一次性 vs 流式

| | `runChain()` | `streamChain()` |
| --- | --- | --- |
| 调用方法 | `chain.invoke({ query })` | `chain.stream({ query })` |
| 返回 | `Promise<string>` | `AsyncGenerator<string>` |
| 首字延迟 | 需等全部生成 | 立刻开始吐字 |
| 适用 | 短回答、需整体加工（如 JSON 解析） | 长回答、需实时反馈 |

`streamChain` 是一个 **async generator**（`async function*` + `yield`），消费方式是 `for await...of`：

```ts
async *streamChain(query: string): AsyncGenerator<string> {
  const stream = await this.chain.stream({ query });
  for await (const chunk of stream) yield chunk;   // 来一块吐一块
}
```

### 4. 从 Generator 到 SSE：`from` + `map` + `@Sse`

Nest 的 `@Sse()` 要求处理器返回 `Observable<MessageEvent>`，因此需要把 AsyncGenerator 转成 RxJS 流：

```ts
// src/ai/ai.controller.ts
@Sse('chat/stream')
chatStream(@Query('query') query: string): Observable<{ data: string }> {
  return from(this.aiService.streamChain(query)).pipe(
    map((chunk) => ({ data: chunk })),   // SSE 协议要求 { data }
  );
}
```

- `from()`：把 AsyncGenerator / Promise / 数组 统一转成 Observable，generator 每 `yield` 一次就触发一次
- `map()`：逐块转换成 SSE 消息格式；Nest 会把它序列化成 `data: <chunk>` 行并推给客户端
- `@Sse()`：自动设置 `Content-Type: text/event-stream` 等响应头，并保持长连接
- Observable **complete**（generator 跑完）时，Nest 关闭该 SSE 连接

### 5. 前端测试页（`public/sse-test.html`）

因为根模块用 `ServeStaticModule` 托管了 `public/`，启动服务后直接访问：

```
http://localhost:3000/sse-test.html
```

页面用原生 `EventSource` 实现，可以直接改 API 地址与问题、点按钮看逐字输出：

```js
const eventSource = new EventSource(`${baseUrl}/ai/chat/stream?query=${encodeURIComponent(q)}`);
eventSource.onmessage = ({ data }) => { output.textContent += data; };
```

两个容易困惑的现象，解释如下：

1. **中文参数必须 `encodeURIComponent`**：否则 URL 里的中文会破坏 query 结构
2. 页面里监听的 `done` 事件，后端当前**不会**发送（控制器只产出 `{ data: chunk }`，没有设置事件类型），
   所以流结束时状态会落到 `onerror` 分支显示「连接已结束」。若想要优雅的结束信号，见下文「扩展练习」

> 注意：`public/` 下没有 `index.html`，且 `GET /` 已被 `AppController` 占用，所以访问根路径返回的是 `Hello World!` 而不是页面。

## Book 模块详解

### 1. 分层与依赖方向

```
BookController          接收 HTTP 请求、解析参数（@Body / @Param）、调用 Service
      │  依赖
      ▼
BookService             业务逻辑；只依赖接口 BookRepository
      │  依赖（通过 token 'BOOK_REPOSITORY' 注入）
      ▼
BookRepository（接口）   定义数据访问契约：findAll(): Promise<Book[]>
      ▲  实现
      │
book.module.ts 里的 useFactory   当前返回内存 mock，将来换成 ORM Repository
```

关键点：`BookService` 只认接口，数据源实现由模块层提供——
**换数据库只改 `book.module.ts`，Service 与 Controller 一行都不用动**，这正是依赖注入的价值所在。

### 2. 数据源：`BOOK_REPOSITORY` 工厂

```ts
{
  provide: 'BOOK_REPOSITORY',
  useFactory() {
    const books = [
      { id: 1, title: 'Book 1' },
      { id: 2, title: 'Book 2' },
      { id: 3, title: 'Book 3' },
    ];
    return { findAll: () => [...books] };   // 返回副本，避免外部直接改内部数组
  },
}
```

注释里也给出了真实项目中的写法（替换为 ORM）：

```ts
inject: [DataSource],
useFactory: (ds: DataSource) => ds.getRepository(Book),
```

### 3. 接口现状（重要）

本模块保留了 Nest CLI 生成的脚手架实现，**不要误以为 CRUD 已经全部可用**：

| 路由 | 当前行为 | 说明 |
| --- | --- | --- |
| `GET /book` | **真实返回数据** | 走 `BOOK_REPOSITORY.findAll()`，返回预置的 3 条 `{ id, title }` |
| `POST /book` | 占位 | 固定返回字符串 `This action adds a new book`，**不会真的新增** |
| `GET /book/:id` | 占位 | 返回 `This action returns a #<id> book` |
| `PATCH /book/:id` | 占位 | 返回 `This action updates a #<id> book` |
| `DELETE /book/:id` | 占位 | 返回 `This action removes a #<id> book` |

两个由此产生的现象：

- 预置数据只有 `id` 和 `title`，**没有 `author`**，所以 `GET /book` 的响应体里看不到 author（尽管 DTO 里有这个字段）
- `BookRepository.findAll()` 声明为 `Promise<Book[]>`，而 mock 实现是同步返回数组；JS 允许这么写（Nest 会 await 非 Promise 值），
  但真实异步数据源下应改为 `async` 或直接返回 Promise

### 4. DTO 与 Entity

| 概念 | 文件 | 职责 |
| --- | --- | --- |
| DTO | `dto/create-book.dto.ts` | 定义请求体结构：`title`、`author`（配 `@ApiProperty` 供 Swagger 展示） |
| DTO | `dto/update-book.dto.ts` | `PartialType(CreateBookDto)`：继承全部字段但都变可选，契合 PATCH 的部分更新语义 |
| Entity | `entities/book.entity.ts` | 空的类占位，注释里给出了 TypeORM 实体写法，代表「数据库表结构」 |

`Entity` 与 `DTO` 的分工：Entity 对应数据库表字段，DTO 对应 API 的输入输出，两者可以不同（DTO 常用来隐藏敏感字段或合并多表数据）。

**校验尚未启用**：`@ApiProperty` 只影响文档，不产生运行时校验；项目也未安装 `class-validator` / `class-transformer`。
要真正校验请求体（如 `title` 必填），需要：

```bash
pnpm add class-validator class-transformer
```

```ts
// DTO 上加装饰器
@IsString() @IsNotEmpty() title: string;

// main.ts 启用全局校验管道
app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
```

### 5. 快速替换成真实数据库

1. 安装 ORM（如 `@nestjs/typeorm typeorm pg`），在 `AppModule` 里配置 `TypeOrmModule.forRoot(...)`
2. 把 `Book` 实体补全（`@Entity()` + `@Column()`）
3. 把 `book.module.ts` 的 `BOOK_REPOSITORY` 工厂改为返回真实 Repository
4. 把 `BookService` 的占位实现补全（`save` / `findOneBy` / `update` / `delete`）

## 环境变量

```bash
cp .env.example .env
```

| 变量 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | 是 | 模型服务密钥（缺失时代码兜底为空串，请求会 401） | `sk-xxx` |
| `OPENAI_BASE_URL` | 建议填 | OpenAI 兼容端点；**不填则走官方 `api.openai.com`** | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `MODEL_NAME` | 否 | 模型名，代码兜底 `gpt-4o-mini` | `qwen-plus` |
| `PORT` | 否 | 监听端口，默认 `3000` | `3100` |

`.env` 已被 `.gitignore` 忽略，不会提交到仓库；`.env.example` 只是模板，不要往里写真实 Key。

## 快速开始

### 1. 环境要求

- Node.js 18+
- 一个可访问的 OpenAI 兼容模型服务（示例使用通义千问 DashScope 兼容模式）

### 2. 安装依赖

```bash
pnpm install   # 或 npm install
```

### 3. 配置 `.env`

见上一节，把 `OPENAI_API_KEY` 等填好。

### 4. 启动

```bash
pnpm run start:dev    # 开发模式，代码改动自动重启
pnpm run start        # 普通启动
pnpm run start:prod   # 生产模式（需先 pnpm run build）
```

看到类似 `Nest application successfully started` 即启动成功，默认地址 `http://localhost:3000`。

### 5. 验证

```bash
# 根路由
curl.exe http://localhost:3000/

# 一次性对话
curl.exe "http://localhost:3000/ai/chat?query=什么是LangChain"

# 流式对话（-N 关闭缓冲，才能看到逐字输出）
curl.exe -N "http://localhost:3000/ai/chat/stream?query=什么是LangChain"

# 图书列表（真实数据）
curl.exe http://localhost:3000/book
```

> Windows PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，参数行为不同，建议显式用 `curl.exe`（如上）。
> 中文参数最好先手动 URL 编码，或直接用浏览器访问 `/sse-test.html` 测试。

## 接口说明

| 方法 | 路径 | 参数 | 返回 | 状态 |
| --- | --- | --- | --- | --- |
| GET | `/` | — | `Hello World!`（text/html） | 可用 |
| GET | `/ai/chat` | `query` (必填) | `{ "answer": "..." }` | 可用 |
| GET | `/ai/chat/stream` | `query` (必填) | SSE 事件流，每块 `data: <文本>` | 可用 |
| GET | `/api-docs` | — | Swagger UI 页面 | 可用 |
| POST | `/book` | body `{ title, author }` | 占位字符串 | 脚手架 |
| GET | `/book` | — | 3 条预置图书 | 可用 |
| GET | `/book/:id` | 路径 `id` | 占位字符串 | 脚手架 |
| PATCH | `/book/:id` | 路径 `id` + body | 占位字符串 | 脚手架 |
| DELETE | `/book/:id` | 路径 `id` | 占位字符串 | 脚手架 |

对话接口示例：

```bash
curl.exe "http://localhost:3000/ai/chat?query=用一句话解释NestJS"
# {"answer":"NestJS 是一个基于 TypeScript 的渐进式 Node.js 服务端框架……"}
```

SSE 响应形如（每个数据块一行，空行分隔）：

```
data: NestJS
data: 是
data: 一个
...
```

## Swagger 与 OpenAPI

**在线文档**：启动服务后访问 <http://localhost:3000/api-docs>，可直接在页面上调试接口。
标题与描述在 `main.ts` 的 `DocumentBuilder` 中配置。

**导出 JSON**：

```bash
pnpm run generate:openapi    # ts-node src/generate-openapi.ts
```

会在项目根目录生成 `openapi.json`（可作为 Postman / 代码生成的输入）。
该脚本以 `logger: false` 创建应用、生成后立即 `app.close()`，不会占用端口。

接口元数据来自三类装饰器：

| 装饰器 | 作用 |
| --- | --- |
| `@ApiTags('AI')` / `@ApiTags('图书')` | 分组，显示为文档中的板块 |
| `@ApiOperation({ summary, description })` | 接口标题与说明 |
| `@ApiQuery` / `@ApiParam` / `@ApiProperty` | 参数与字段的说明、示例、类型 |
| `@Sse` | 也会被识别为接口，出现在文档中 |

另外 `nest-cli.json` 启用了 `@nestjs/swagger` 编译插件：

| 选项 | 作用 |
| --- | --- |
| `introspectComments: true` | 尝试从源码注释中提取描述，减少手写 `description` |
| `classValidatorShim: true` | 若安装了 `class-validator`，自动把其装饰器（`@IsString` 等）映射为文档里的约束说明 |

注意该插件只在通过 `nest build` / `nest start`（CLI 编译）时生效；
`generate:openapi` 是用 `ts-node` 直接跑脚本，文档内容以代码里的 Swagger 装饰器为准。

## 测试

```bash
pnpm run test        # 单元测试（src/**/*.spec.ts）
pnpm run test:e2e    # 端到端测试（test/*.e2e-spec.ts，supertest 真发 HTTP 请求）
pnpm run test:cov    # 覆盖率
```

现有用例：

| 文件 | 类型 | 断言 |
| --- | --- | --- |
| `src/app.controller.spec.ts` | 单元 | 用 `Test.createTestingModule` 组装最小模块，`app.get(AppController)` 取出实例，断言 `getHello()` 返回 `Hello World!` |
| `test/app.e2e-spec.ts` | e2e | 启动完整 `AppModule`，`GET /` 期望 200 + `Hello World!` |

单元测试与 e2e 的分工：前者只实例化目标类（速度快、便于替换 mock），后者会走完整路由与中间件栈（更接近真实）。

## 技术要点

1. **链的输入是对象，不是字符串**
   `chain.invoke({ query })` 的 key 必须与 `PromptTemplate` 中的 `{占位符}` 一致，否则要么报错要么把字面量 `{query}` 发给了模型。

2. **`@Sse()` 的返回值必须是 `Observable<MessageEvent>`**
   纯 `string`、`Promise<string>` 都不行。AsyncGenerator 需要先经 `from()` 转换，再 `map()` 成 `{ data }`。

3. **`ConfigModule` 的 `isGlobal: true`**
   让 `ConfigService` 全局可注入，`AiModule` 无需 `imports: [ConfigModule]` 就能在工厂函数里用它。
   若去掉 `isGlobal`，工厂的 `inject: [ConfigService]` 会直接报依赖解析失败。

4. **静态资源与根路由的冲突**
   `ServeStaticModule` 托管 `public/`，但根路径 `/` 已被 `AppController` 的 `@Get()` 占用；
   同时 `public/` 没有 `index.html`，所以「访问 `/` 看页面」在这套配置下不可行，页面请用 `/sse-test.html` 访问。

5. **`private readonly` 构造函数注入**
   `constructor(private readonly aiService: AiService) {}` 是 TS 语法糖：自动声明成员并赋值，
   等价于手写成员 + `this.aiService = aiService`（后者在 Nest CLI 生成的代码里也能看到）。

6. **`@Param('id')` 永远是字符串**
   `/book/42` 提取出的是 `"42"`，所以 Controller 里用一元加号 `+id` 转数字。
   生产环境更推荐 `ParseIntPipe`：`@Param('id', ParseIntPipe) id: number`（非法输入自动返回 400）。

7. **`PartialType` 用 Swagger 版本而非 mapped-types 版本**
   `@nestjs/swagger` 的 `PartialType` 会同时保留字段元数据，这样可选字段在文档里才是「非必填」。

8. **PATCH vs PUT**
   PATCH 表示部分更新（只传要改的字段），PUT 表示整体替换（需要传完整对象）。本项目用 `PATCH` + `PartialType`。

## 扩展练习

1. **给 SSE 加结束事件**
   把 `chatStream` 改为返回 `Observable<{ data: string; type?: string }>`，
   在 generator 结束后追加一条 `{ data: '', type: 'done' }`，前端即可用 `addEventListener('done', ...)` 收尾。
2. **加对话历史**
   引入 `BufferMemory` / `ChatMessageHistory`，或把 `prompt` 换成 `ChatPromptTemplate.fromMessages([...])` 并保留用户会话 ID。
3. **补全图书 CRUD**
   把内存数组改成真正的读写（`create` / `update` / `delete`），并把 `BookRepository` 接口扩成完整契约。
4. **加上请求校验**
   安装 `class-validator` + `class-transformer`，写 DTO 装饰器，并在 `main.ts` 启用 `ValidationPipe`。
5. **换成流式 JSON / 结构化输出**
   把 `StringOutputParser` 换成 `JsonOutputParser`（配合 Zod Schema），返回结构化的对象。

## 常见问题

| 现象 | 排查方向 |
| --- | --- |
| 启动报 `EADDRINUSE: address already in use :::3000` | 3000 被占用（本仓库其他示例也会用 3000），改 `.env` 里的 `PORT`，或用 `Get-NetTCPConnection -LocalPort 3000` 找到占用进程 |
| `/ai/chat` 返回 400 或空回答 | `query` 参数缺失或为空；该参数必填 |
| 模型请求报 401 / 404 | `OPENAI_API_KEY` 是否为该端点签发；`OPENAI_BASE_URL` 是否与模型服务匹配；`MODEL_NAME` 是否在该服务的模型列表里 |
| 请求发到了 `api.openai.com` | 未配置 `OPENAI_BASE_URL`（代码中无兜底，缺省即官方端点） |
| 输出里出现字面量 `{query}` | `invoke` 传入的不是 `{ query }` 对象，或占位符名与 key 不一致 |
| SSE 页面一直转圈、没有逐字效果 | 服务未启动 / 地址填错；`curl` 测试需加 `-N`，否则会被缓冲成一次性输出 |
| SSE 连接显示「连接已结束」而不是「完成」 | 正常现象：后端不发送 `done` 事件（见前文说明），想消除请做「扩展练习 1」 |
| `GET /book` 响应里没有 author | 预置 mock 数据只有 `id` / `title`，与 DTO 字段无关 |
| 改了 `.env` 不生效 | `.env` 在进程启动时读取；重启服务（`start:dev` 的 watch 不会重载环境变量） |
| `POST /book` 后 `GET /book` 没有新数据 | 预期行为：除 `GET /book` 外其余接口仍是脚手架占位 |

## 依赖

| 包 | 作用 |
| --- | --- |
| `@nestjs/common` / `@nestjs/core` / `@nestjs/platform-express` | NestJS 核心：DI、模块、装饰器、HTTP 适配层 |
| `@nestjs/config` | 读取 `.env`，提供 `ConfigService` |
| `@nestjs/swagger` | Swagger / OpenAPI 文档生成与在线 UI |
| `@nestjs/serve-static` | 托管 `public/` 静态文件 |
| `@nestjs/mapped-types` | `PartialType` 等工具（本项目实际使用 swagger 版本，依赖随 CLI 模板保留） |
| `@langchain/core` | LangChain 核心抽象：`PromptTemplate`、`Runnable`、`StringOutputParser` |
| `@langchain/openai` | `ChatOpenAI`：接入 OpenAI 兼容接口（通过 `baseURL` 指向任意兼容网关） |
| `rxjs` | `Observable` 流，SSE 端点的基础 |
| `reflect-metadata` | 装饰器元数据支持（Nest 运行必需） |
| `class-validator` / `class-transformer` | **未安装**：如需请求体校验请自行添加（见上文说明） |
