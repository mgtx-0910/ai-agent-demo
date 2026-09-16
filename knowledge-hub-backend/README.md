# knowledge-hub-backend

知识中台后端的文档服务：一套 NestJS 应用同时写两种数据库 —— **PostgreSQL 存元数据**、**MongoDB 存正文**，
对外提供文档的创建、列表、详情、更新、软删除接口。

当前范围只做「文档 CRUD + 双库一致性」这条主线，鉴权、检索、向量化都还没有，属于可运行的最小闭环。

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | NestJS 11 | 模块化 + 依赖注入 |
| 语言 | TypeScript 5.7 | 开启 `strictNullChecks` |
| 关系库 | PostgreSQL 16 + pgvector | 元数据；镜像自带 pgvector，为后续向量检索预留 |
| ORM | TypeORM 0.3 | `EntityManager` + QueryBuilder |
| 文档库 | MongoDB 7 | 正文；Mongoose 9 |
| 校验 | class-validator / class-transformer | 配合全局 `ValidationPipe` |
| 主键 | snowflake-id | 应用层生成 64 位趋势递增 ID |
| 包管理 | pnpm（也有 `pnpm-lock.yaml`） | `npm` 同样可用 |

## 双库架构

```
                 客户端
                   │  HTTP + JSON
                   ▼
        ┌──────────────────────────┐
        │  ValidationPipe（全局）   │  白名单 / 类型转换 / 拒绝多余字段
        └────────────┬─────────────┘
                     ▼
        DocumentController  →  DocumentService
                     │                 │
        元数据（关系型）│                 │ 正文（长文本）
                     ▼                 ▼
        PostgreSQL kh_document     MongoDB document_content
              id  (雪花ID)  ◄──┐
        content_id (varchar) ──┘──►  _id (ObjectId)
              id  ◄──────────────────  documentId
```

关联关系（两份互指的字段，务必成对维护）：

| Postgres `kh_document` | MongoDB `document_content` | 用途 |
| --- | --- | --- |
| `id` (`BIGINT`) | `documentId` (`String`) | 反查某文档的正文 |
| `content_id` (`VARCHAR UNIQUE`) | `_id` (`ObjectId`) | 详情页按 id 精确取正文 |

**为什么拆两个库**：元数据要按分类 / 团队 / 状态过滤并分页统计，交给关系库最自然；
正文是几 KB 到几十 KB 的 Markdown，且后续要挂向量、附件、版本历史，放文档库更灵活。
代价是失去了跨库事务，只能靠「补偿 + 软删」保证最终一致（见「双库一致性」）。

## 目录结构

```
knowledge-hub-backend/
├── src/
│   ├── main.ts                       # 入口：创建应用 → 挂全局校验管道 → 监听端口
│   ├── app.module.ts                 # 根模块：装配 Config / Postgres / Mongo
│   ├── app.controller.ts             # GET / 存活探针（Hello World）
│   ├── app.service.ts
│   ├── common/
│   │   ├── snowflake-id.ts           # 雪花 ID 生成器（全局单例）
│   │   └── transformers/
│   │       └── bigint.transformer.ts # Postgres BIGINT ↔ JS string
│   ├── types/
│   │   └── snowflake-id.d.ts         # snowflake-id 包的类型声明（该包不带 d.ts）
│   └── document/
│       ├── document.module.ts        # 注册 Mongo 模型 + 控制器 / 服务
│       ├── document.controller.ts    # /documents 路由（5 个接口）
│       ├── document.service.ts       # 双库读写与一致性处理的唯一入口
│       ├── entities/
│       │   └── document.entity.ts    # PG 表 kh_document 的实体映射
│       ├── schemas/
│       │   └── document-content.schema.ts # Mongo 集合 document_content
│       └── dto/
│           ├── create-document.dto.ts
│           ├── update-document.dto.ts   # PartialType(OmitType(create, ['createBy']))
│           └── query-document.dto.ts    # 列表过滤 + 分页参数
├── init-scripts/
│   ├── postgresql/init.sql           # 建表 kh_document
│   └── mongodb/init.js               # 建业务账号 + 集合 + 索引
├── test/app.e2e-spec.ts              # 脚手架自带 e2e（只测 GET /）
├── docker-compose.yml                # Postgres / pgAdmin / Mongo / mongo-express
├── curl.md                           # 全接口 curl 示例（含一份完整中文长正文）
└── .env.example                      # 环境变量示例
```

## 快速开始

```bash
# 1. 起依赖库（Postgres + Mongo + 两个 Web GUI）
docker compose up -d
docker compose ps                     # 等 postgres / mongodb 变成 healthy

# 2. 配置环境变量
cp .env.example .env                  # Windows: copy .env.example .env

# 3. 装依赖并启动（watch 模式）
pnpm install
pnpm start:dev

# 4. 验证
curl -s http://localhost:3000/                         # Hello World!
curl -s http://localhost:3000/documents                # { "items": [], "total": 0, ... }
```

建文档、更新、软删的完整示例（包含一份可直接粘贴的中文长文）见 [curl.md](./curl.md)。

GUI 入口：

| 服务 | 地址 | 登录 |
| --- | --- | --- |
| mongo-express | http://localhost:8081 | `me_admin` / `me_123456` |
| pgAdmin | http://localhost:8088 | `admin@admin.com` / `admin` |
| Postgres | `localhost:15432` | `user` / `123456`，库 `knowledge_hub`（宿主机端口非 5432，原因见「已知问题 6」） |
| MongoDB | `localhost:27017` | `mongo_user` / `mongo_pass123`（管理） |

> mongo-express 有两组账号：页面登录用 `ME_CONFIG_BASICAUTH_*`，它连库用 `ME_CONFIG_MONGODB_*`，别填混。

## 环境变量

`.env` 放在项目根目录（已被 `.gitignore` 忽略）。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `PORT` | 否 | `3000` | HTTP 端口 |
| `POSTGRES_HOST` | 否 | `localhost` | |
| `POSTGRES_PORT` | 否 | `15432` | 同时作为 compose 的端口映射变量（`${POSTGRES_PORT:-15432}:5432`），两边天然一致；容器内始终是 5432 |
| `POSTGRES_USER` | 否 | `user` | |
| `POSTGRES_PASSWORD` | 否 | `123456` | |
| `POSTGRES_DB` | 否 | `knowledge_hub` | |
| `MONGO_URI` | 否 | 见 `.env.example` | 完整连接串，含 `authSource=admin` |
| `SNOWFLAKE_WORKER_ID` | 否 | `1` | 机器号 0–1023，多实例部署时必须各不相同；**注意见下文「已知问题」** |
| `SNOWFLAKE_OFFSET` | 否 | `1704067200000` | 纪元偏移（毫秒），默认约 2024-01-01 |

## 接口一览

| 方法 | 路径 | 请求参数 | 返回 |
| --- | --- | --- | --- |
| `GET` | `/` | — | `Hello World!`（存活探针） |
| `POST` | `/documents` | `CreateDocumentDto`（body） | 文档元数据 + `content` |
| `GET` | `/documents` | `QueryDocumentDto`（query） | `{ items, total, page, pageSize }`，**不含正文** |
| `GET` | `/documents/:id` | 雪花 ID | 文档元数据 + `content` |
| `PATCH` | `/documents/:id` | `UpdateDocumentDto`（body，字段全可选） | 文档元数据 + `content` |
| `DELETE` | `/documents/:id` | — | `{ id, deleted: true }` |

列表查询参数：

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `title` | string | — | 标题模糊匹配（PG `ILIKE`，不区分大小写） |
| `categoryId` / `teamId` / `authorId` | string | — | 精确匹配 |
| `status` | int | — | `0` 草稿 / `1` 已发布 / `2` 已归档 |
| `page` | int ≥ 1 | `1` | 页码 |
| `pageSize` | int 1–100 | `20` | 每页条数 |

条件之间是 AND，不传即不参与过滤；结果按 `created_at DESC` 排序，且始终排除已软删记录。

```bash
curl -s 'http://localhost:3000/documents?page=1&pageSize=10&title=入职&status=1' | jq
```

## 数据模型

### PostgreSQL `kh_document`（元数据）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | BIGINT PK | 雪花 ID，应用层生成 |
| `title` | VARCHAR NOT NULL | 标题 |
| `content_id` | VARCHAR NOT NULL UNIQUE | 指向 Mongo `_id` |
| `summary` | VARCHAR | 摘要（可外部传入） |
| `category_id` / `team_id` / `author_id` / `create_by` / `update_by` | BIGINT | 各类 ID，均用 `bigintTransformer` 转字符串 |
| `tags` | VARCHAR | 逗号分隔字符串，不是数组 |
| `status` | SMALLINT | `0` 草稿 / `1` 已发布 / `2` 已归档 |
| `word_count` | INT | 由正文自动统计，不接受传入 |
| `view_count` / `like_count` / `comment_count` / `favourite_count` | INT | 计数位，本 CRUD 只读 |
| `publish_time` | TIMESTAMP | 仅「首次变已发布」时写入 |
| `is_public` | BOOLEAN | 是否公开（过滤逻辑待权限模块） |
| `created_at` / `updated_at` | TIMESTAMP | `@CreateDateColumn` / `@UpdateDateColumn` 自动维护 |
| `deleted` | BOOLEAN | 逻辑删除 |

### MongoDB `document_content`（正文）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | ObjectId | 对应 `kh_document.content_id` |
| `documentId` | String（唯一索引） | 对应 `kh_document.id` |
| `content` | String | Markdown 正文 |
| `contentLength` | Number | 字符数（`content.length`） |
| `contentSummary` | String | 预览摘要，默认正文前 200 字 |
| `version` | Number | 每次改正文 +1，初始 1 |
| `deleted` | Boolean | 逻辑删除 |
| `createdAt` / `updatedAt` | Date | 由 `timestamps: true` 自动维护 |

## 关键实现

### 1. 雪花 ID 与 BIGINT 精度

63 位整数远超 JS 安全整数范围（2^53-1），所以主键**全链路用 string 传递**：
应用层用 `snowflake-id` 生成字符串，写库时由 `bigintTransformer` 交给 PG 按 BIGINT 存，
读出来再统一 `String(v)`。一旦某处把它当 number 处理，末尾几位会静默变 0。

### 2. 双库一致性（没有跨库事务）

Postgres 与 Mongo 是两个独立连接，无法放进同一个事务，因此不做原子性承诺，改用「补偿 + 软删」：

| 操作 | 顺序 | 失败时的处理 |
| --- | --- | --- |
| 创建 | 先写 Mongo 拿 `_id`，再写 PG | PG 失败 → 物理删除刚写的 Mongo 正文（`create` 的 catch），不留孤儿 |
| 更新 | 先改 Mongo 正文，再 save PG | 会留下「新正文 + 旧元数据」，需调用方重试收敛 |
| 删除 | 先标 PG，再标 Mongo | 两侧都只置 `deleted = true`，可人工对账修复 |

另外，`update` 改正文时若 Mongo 返回 `matchedCount === 0` 会直接抛 `BadRequestException`，
避免出现「元数据说改了、正文其实没改」的静默不一致。

### 3. 软删除

`DELETE /documents/:id` 把两侧 `deleted` 都置为 `true`，正文不物理删除（便于恢复与审计）。
代价是所有读路径必须显式带 `deleted = false`：`findAll` 的 where、`findOne` / `update` / `remove` 的查询条件都已带上。

### 4. 校验管线

`main.ts` 里全局 `ValidationPipe` 开了三项，理解它们才能看懂接口行为：

| 选项 | 作用 | 直接影响 |
| --- | --- | --- |
| `whitelist: true` | 剔除 DTO 未声明字段 | 传 `wordCount`、随机字段不会进业务层 |
| `transform: true` | 按 DTO 类型转换 | query 的 `"2"` 能通过 `@Type(() => Number)` 变成 `2` |
| `forbidNonWhitelisted: true` | 有未声明字段直接 400 | 少了拼写检查的容忍度，但字段名写错会立刻暴露 |

`UpdateDocumentDto` 用 `PartialType(OmitType(CreateDocumentDto, ['createBy']))` 派生：
既复用了校验规则，又把「创建人不可改」这一约束固化在类型里，同时新增 `updateBy`。

### 5. 字数统计

`countWords()` 是混合口径：CJK 汉字（`U+4E00–U+9FFF`）每字算 1，其余文本按空白分词每词算 1。
Markdown 标记（`#`、`-`）会被计入拉丁词，若以后要做精确统计需先剥离语法。
另有 `contentLength` 记录纯字符数，两者口径不同，不要混用。

## 已知问题与注意事项

1. **`.env` 里的 `SNOWFLAKE_WORKER_ID` / `SNOWFLAKE_OFFSET` 实际不生效**
   `src/common/snowflake-id.ts` 在 **import 阶段**（模块顶层）就构造了单例，而 `.env` 是在
   `ConfigModule.forRoot()` 于模块初始化时才写入 `process.env` 的，时机更晚，因此这两个变量稳定取默认值。
   验证：把 `SNOWFLAKE_OFFSET` 改成一个明显不同的值，生成的 ID 长度不变即为未生效。
   修复方式二选一：改用系统环境变量（容器 `env` 注入），或把读取挪到运行时（注入 `ConfigService`）。

2. **表结构由 `init.sql` 定义，`synchronize: false`**
   改实体不会改表。新增字段需要：改 `init.sql` + 改实体，并在**新环境**重建（已有数据卷不会重跑初始化脚本）。
   临时同步可手动执行：`docker exec -i knowledge_hub_postgres psql -U user -d knowledge_hub < init-scripts/postgresql/init.sql`。

3. **`init-scripts` 只在空数据卷时执行一次**
   改了 `init.sql` / `init.js` 想重跑，必须先 `docker compose down` 并删除 `volumes/`（会丢数据）。

4. **`summary` 与 `contentSummary` 是两份数据**
   PG 的 `summary` 只在显式传入时更新；Mongo 的 `contentSummary` 在只传 `content` 时会按新正文重算。
   于是「只传 content、不传 summary」会让两者出现差异，前端展示建议以一处为准。

5. **更新 / 删除没有跨库事务**（见上文），高并发或异常退出时可能出现短暂不一致，需靠重试或对账收敛。

6. **Postgres 宿主机端口默认是 `15432`，不是 `5432`**
   本机很容易已有其它项目的 Postgres 容器占着 5432（本仓库里 `langfuse-test-postgres-1` 占 5432、`pg_vector_db` 占 5433），
   被占时的报错是 `Bind for 0.0.0.0:5432 failed: port is already allocated`；
   更麻烦的是**失败会顺着 `depends_on` 往下传染**：postgres 起不来 → 依赖它的 pgadmin / mongo-express 一直停在 `Created`，
   日志里就会出现「某个服务 `Error dependency xxx failed to start`」这种看着像别处出错的提示。
   现在 compose 用 `${POSTGRES_PORT:-15432}:5432`，`.env` 里设为 `15432`，要换端口只改 `.env` 一处（容器内端口始终 5432，服务间互访不受影响）。
   `27017`（MongoDB）与 GUI 端口 `8088` / `8081` 同理，冲突时改 compose 的宿主机侧。

7. **完全没有鉴权**：`authorId` / `createBy` / `updateBy` 全部由调用方自报，任何能访问 3000 端口的人都能改任何文档。
   仅限本地学习使用，切勿直接部署。

8. **`status` 在 JSON 里必须传数字**：`@IsEnum` 校验的是枚举值，传 `"1"` 或 `"Published"` 都会 400。

## 常见错误排查

| 现象 | 原因与处理 |
| --- | --- |
| `400 property xxx should not exist` | 全局校验开了 `forbidNonWhitelisted`：body / query 里出现了 DTO 未声明的字段，删掉或改名 |
| `400 status must be one of the following values` | `status` 传成了字符串，改传数字 `0` / `1` / `2` |
| `400 page must be an integer number` | query 参数没走 `@Type(() => Number)`；确认请求参数本身是纯数字 |
| `404 Document xxx not found` | id 不存在，或该文档已被软删（软删后详情一律 404） |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | 宿主机端口被别的容器占着：`docker ps` 找占用者，改 `.env` 的 `POSTGRES_PORT` 后重新 `docker compose up -d`。注意它会把 `depends_on` 链上的 pgadmin / mongo-express 一起拖成 `Created` |
| `ECONNREFUSED 127.0.0.1:15432` / `:27017` | 依赖库没起、端口被改过，检查 `docker compose ps` 与 `.env` 的 `POSTGRES_PORT` / `MONGO_URI` |
| `relation "kh_document" does not exist` | 数据卷不是新建的，初始化脚本没执行；按「注意事项 2」手动执行 `init.sql` |
| pgAdmin 显示 `unhealthy` 但页面能正常打开 | 该镜像里**没有 `curl`**（只有 busybox 的 `wget`），用 curl 做健康检查会一直失败；compose 里已改成 `wget -qO- http://localhost:80/misc/ping` |
| mongo-express 能打开却连不上库，日志刷 `mongo: Name does not resolve` | 镜像自带默认 `ME_CONFIG_MONGODB_URL=mongodb://mongo:27017`，而它**优先于** `ME_CONFIG_MONGODB_SERVER` 生效；本项目服务名是 `mongodb` 不是 `mongo`，compose 里已显式覆盖该变量 |
| `400 Document content xxx not found` | PG 有元数据但 Mongo 正文缺失（多为手工删过数据），需要修复数据 |
| 列表查不到刚建的数据 | 默认按 `created_at DESC` 且过滤 `deleted = false`，确认没被软删、过滤条件是否过严 |

## 后续可扩展

- **鉴权与权限**：接入 JWT，把 `authorId` 从「调用方自报」改成「取自 token」，并用 `teamId` + `isPublic` 做可见性过滤
- **全文 / 向量检索**：镜像已带 pgvector，可对正文做 embedding 后建立向量索引，配合 `ILIKE` 做混合检索
- **乐观锁**：Mongo 侧已有 `version`，可扩展为并发更新检测
- **标签规范化**：`tags` 目前是逗号串，检索能力弱，可改为 `text[]` 或独立标签表
- **封面图上传**：接入对象存储（见同级 `oss-test`），`coverImage` 只存 URL
- **补偿任务**：定时对账 PG 与 Mongo 的 `deleted` / `content_id`，自动修复不一致
