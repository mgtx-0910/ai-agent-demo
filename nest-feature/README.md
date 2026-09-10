# nest-feature

基于 **NestJS 11** 的核心特性学习项目：用一个小而全的「用户管理」例子，把 Nest 请求生命周期的四大件 —— **Guards（守卫）/ Pipes（管道）/ Filters（异常过滤器）/ Interceptors（拦截器）**，以及 **自定义参数装饰器、@Global 全局模块、@nestjs/jwt** 全部串起来跑一遍。

## 功能特性

- **认证鉴权（`auth/` + `common/guards/`）**
  - 全局模块 `@Global()` 导出 `AuthService`，任意模块免 import 直接注入
  - `AuthGuard` 手写守卫：`Bearer Token` 提取 → 校验 → 越权判断（普通用户只能操作自己，管理员不限）
  - 静态 Token 映射模拟用户：`admin-token-123`（管理员）/ `user-token-456`（普通用户）
- **参数管道（`common/pipes/`）**
  - `ParsePositiveIntPipe`：`:id` 路径参数必须是正整数
  - `ParseAgePipe`：`age` 查询参数非空、数字、0~150 范围校验
- **全局异常过滤器（`common/filters/`）**：所有异常统一转成 `{ code, data, message }`
- **全局响应拦截器（`common/interceptors/`）**：成功响应统一包 `{ code: 200, data, message: '成功' }`，并打印请求/响应耗时日志
- **自定义参数装饰器（`common/decorators/`）**：`@CurrentUser()` 一行取出 `request.user`
- **JWT 真签真验（`jwt-test/`）**：根模块全局注册 `JwtModule`，`sign / verify` 完整演示，与 auth 的静态 Token 互为对照
- **分层 CRUD（`user/`）**：Controller → Service → DTO（`PartialType`）→ Entity 标准分层，内存数据

## 目录结构

```
nest-feature/
└── src/
    ├── main.ts                       # 启动入口（注册全局 Filter / Interceptor）
    ├── app.module.ts                 # 根模块（全局注册 JwtModule）
    ├── app.controller.ts             # GET / 探活
    ├── app.service.ts
    ├── auth/                         # 全局认证模块（@Global，导出 AuthService）
    ├── jwt-test/                     # JWT 签发 / 校验演示
    ├── user/                         # 用户 CRUD（特性演示主战场）
    │   ├── dto/                      #   CreateUserDto / UpdateUserDto
    │   ├── entities/                 #   User 实体
    │   └── user.controller/service
    └── common/                       # 通用基础设施
        ├── guards/auth.guard.ts      #   鉴权 + 越权守卫
        ├── pipes/                    #   ParsePositiveIntPipe / ParseAgePipe
        ├── filters/all-exceptions.filter.ts
        ├── interceptors/transform.interceptor.ts
        ├── decorators/current-user.decorator.ts
        └── interfaces/               #   ApiResponse / JwtPayload
```

## 数据流流转

### 一次请求在框架内的流转顺序

Nest 处理 HTTP 请求有一套固定的「洋葱模型」顺序，本项目把每一步都落到了真实代码上：

```
HTTP 请求
  │   进入时：query / params 是字符串、body 是原始 JSON 对象
  ▼
① AuthGuard 守卫（auth.guard.ts，仅 @UseGuards 标记的接口）
  │   · 取请求头 Authorization → 拆出 Bearer token
  │   · AuthService.validateToken(token) → 还原 JwtPayload（查不到 → 401）
  │   · 授权：路由带 :id 时，普通用户访问他人资源 → 403
  │   · 放行后把用户信息挂到 request.user
  │   （注意：若在这里被拒绝，流程直接跳到 ⑥ 异常分支，不会执行到 ②）
  ▼
② TransformInterceptor 全局拦截器（transform.interceptor.ts）
  │   · 先打印 [请求] 日志
  │   · 返回一个 RxJS 流（next.handle()），等下游全部处理完再统一"打包"
  ▼
③ Pipe 参数管道（parse-positive-int.pipe.ts / parse-age.pipe.ts）
  │   · 在参数进 Controller 前做「字符串 → number」转换 + 业务校验
  │   · 非法值（"abc"、负数、超范围 age）→ 抛 BadRequestException（400）
  ▼
④ Controller 方法（user.controller.ts）
  │   · 此时拿到的 id 已是 number；@CurrentUser() 装饰器再从
  │     request.user 把登录用户"抽"成方法参数
  │   · 组装好参数，调用 Service
  ▼
⑤ Service 业务逻辑（user.service.ts）
  │   · 操作内存数组 users（相当于数据库）
  │   · 命中 → 返回数据；未命中 → 抛 NotFoundException（404）
  ▼
⑥ 汇合点
  ├─ 成功路径：返回值沿 ② 的流转回拦截器
  │     map：包成 { code: 200, data, message: '成功' }
  │     tap：打印 [响应] 耗时日志
  └─ 异常路径：上面任何一步抛出的异常都被全局 Filter
        （all-exceptions.filter.ts）截获
        统一格式化为 { code, data: null, message } 写回响应
  ▼
HTTP 响应（成功/失败共用同一个 { code, data, message } 外壳）
```

> **为什么有些请求看不到 `[请求]` 日志？**
> 打日志的是 `② Interceptor`。因为 **Guard（①）先于 Interceptor（②）执行**，
> 若请求在 Guard 阶段就被拒绝（无 Token → 401、越权 → 403），流程在 ① 直接跳到异常分支，
> **根本不会执行到 ②**，所以服务端不打印 `[请求]` 日志——但响应仍由全局 Filter 兜底返回。
> 反之，正常通过的请求（含 `GET /user/2` 这类）能看到日志。

### 流转途中"数据"的载体变化

| 阶段 | 数据形态 | 例子 |
|---|---|---|
| 进入框架前 | `params.id = "2"`、`query.age = "25"`、body 为 JSON 对象 | URL 里全是字符串 |
| Guard 校验后 | 注入 `request.user: JwtPayload` | `{ id: 2, username: 'zhangsan', role: 'user' }` |
| Pipe 转换后 | Controller 里的参数已是 `number` | `id = 2`（不再能误用字符串比较） |
| Controller 取用户 | `@CurrentUser()` 读取 `request.user` 注入参数 | `currentUser.username` |
| Service 产出 | `User` 实体 / 抛 `HttpException` | `{ id, username, name, age, role }` |
| 响应外壳 | `ApiResponse<T>`：`{ code, data, message }` | 成功 `code:200`，失败 `code` 为 HTTP 状态码 |

`request.user` 贯穿 Guard → Controller 的传递链：`AuthGuard` 写入 → `@CurrentUser()`
装饰器（`current-user.decorator.ts`）读取，中间不经过路由方法本身。

### 示例接口走查

以 3 个代表性接口看数据流在「全链路 / 无鉴权 / 失败路径」三种形态下的表现。

**① `GET /user/:id` —— 最完整的链路（Guard → Interceptor → Pipe → Controller → Service）**

普通用户 `user-token-456` 查自己：

```bash
curl -i -H "Authorization: Bearer user-token-456" http://localhost:3001/user/2
```

服务端日志会依次出现：

```
① Guard：validateToken(user-token-456) 命中 → request.user = { id:2, role:'user' }
[请求] 2026-..  GET /user/2            ← ② 拦截器入口（在此打印 [请求] 日志）
                                        ← ③ Pipe："2" → number 2
                                        ← ④⑤ Controller 调 Service.findOne(2)
[响应] 2026-..  GET /user/2 耗时 1ms   ← ⑥ 回到拦截器，map 包壳
```

响应：

```json
{ "code": 200, "data": { "id": 2, "username": "zhangsan", "name": "张三", "age": 25, "role": "user" }, "message": "成功" }
```

> 若 Guard 越权校验失败（普通用户查 id=1），流程在 ① 就被掐断——这时还没执行到打日志的拦截器，
> 所以**看不到 `[请求]` 日志**，直接在异常分支 ⑥ 返回 `403`。

**② `GET /user/age-demo?age=25` —— 跳过 Guard，只走 Pipe 的转换/校验**

```bash
curl http://localhost:3001/user/age-demo?age=25
```

数据流只有 `Interceptor → Pipe → Controller → Interceptor`：
`query.age = "25"`（字符串）→ `ParseAgePipe` 转成数字 `25` → Controller 里拼装返回：

```json
{ "code": 200, "data": { "age": 25, "type": "number" }, "message": "成功" }
```

**③ `DELETE /user/abc` —— 失败路径：Pipe 抛 400，被全局 Filter 统一兜底**

```bash
curl -i -X DELETE http://localhost:3001/user/abc
```

`ParsePositiveIntPipe` 发现 `"abc"` 不是正整数 → 抛 `BadRequestException`。
该异常不再继续往 Controller 走，而是被 `AllExceptionsFilter` 捕获并格式化成：

```json
{ "code": 400, "data": null, "message": "参数 id 必须是正整数，当前值: abc" }
```

> 关键点：**成功和失败的响应外壳完全一致**，前端只需解析 `{ code, data, message }` 一种结构。

## JWT 认证机制（`jwt-test/`）

> **先纠正一个常见误区**：JWT 的 payload 是 `base64url` 编码的**明文**，不是密文；前端不做加密，后端也不做"解密"。
> 整条链路是 **后端签发 → 前端存储/携带 → 后端验签**，安全性来自**签名**，而非加密。

### 1. Token 的三段结构

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 . eyJzdWIiOjEsInVzZXJuYW1lIjoiYWRtaW4ifQ . SflKxwRJSMeKKF2Q...
        └── header（算法）                    └── payload（数据，明文）               └── signature（签名）
```

- **header / payload**：JSON 经 `base64url` 编码，**任何人都能还原**（编码 ≠ 加密）：

  ```bash
  node -e "console.log(Buffer.from('<payload 段>','base64url').toString())"
  # → {"sub":1,"username":"admin","iat":...,"exp":...}
  ```

- **signature**：服务端用密钥对前两段做 HMAC，公式为
  `HMAC-SHA256(base64url(header) + "." + base64url(payload), secret)`

所以 payload 可以随便改，但**改完签不出来**——后端重算签名一比对，就知道有没有被篡改。

### 2. 完整运转时序

| 步骤 | 做什么 | 本项目位置 |
|---|---|---|
| ① 签发 | 载荷 + 密钥 → 签名，产出 `access_token` | `JwtTestService.sign()`；密钥与过期时间在根模块全局注册 `JwtModule.register({ secret, signOptions: { expiresIn: '1h' } })` |
| ② 返回 | 接口返回 `{ access_token }` | `POST /jwt-test/sign` |
| ③ 前端存储 | 放进 `localStorage` 或 `httpOnly Cookie` | 前端代码 |
| ④ 前端携带 | 每个请求附 `Authorization: Bearer <token>` | 前端代码 |
| ⑤ 后端提取 | 从请求头切出 token 字符串 | `JwtTestController.extractBearerToken()` / `AuthGuard.extractToken()` |
| ⑥ 后端验签 | 用同一 `secret` 重算签名比对 + 校验 `exp`，通过则还原载荷 | `JwtTestService.verify()` → `jwtService.verify(token)` |
| ⑦ 挂载用户 | 写入 `request.user`，业务层用 `@CurrentUser()` 取用 | `AuthGuard.canActivate()` / `current-user.decorator.ts` |

### 3. 为什么说"后端不解密"

- 标准 JWT 是 **JWS（三段式，只签名不加密）**，不是 **JWE（五段式，才加密）**；
- 后端做的是 **验签（verify）**：`jwtService.verify(token)` 先校验签名与 `exp`，再把 base64url 的 payload **解码**成对象返回——"解码"是读，不是"解密"；
- 正因 payload 是明文，**里面绝不能放密码、身份证等敏感信息**。

### 4. 与 `auth/` 模块的对照

| | `auth/`（模拟实现） | `jwt-test/`（真实 JWT） |
|---|---|---|
| Token 形态 | 固定字符串 `admin-token-123` | 任意载荷签出的 `eyJ...` |
| 校验方式 | `tokenMap` 查表 | `jwtService.verify()` 验签 + 过期检查 |
| 用户范围 | 只能选预置的两个 | 任意 `{ sub, username }` 都能签 |
| 升级路径 | 把 `AuthService.validateToken()` 的查表换成 `jwtService.verify(token)` 即可，Guard / 装饰器链路无需改动 | — |

### 5. 安全要点

- `secret` 必须走环境变量、不能进 git；泄露 = 任何人都能伪造身份；
- 必须校验 `exp`（`@nestjs/jwt` 默认校验），否则 token 永久有效；
- 传输必须 **HTTPS**，否则 token 被截获即可重放；
- 存 `localStorage` 要防 XSS，存 `httpOnly Cookie` 要防 CSRF，按场景取舍。

## 快速开始

### 1. 安装依赖

```bash
pnpm install   # 或 npm install
```

### 2. 启动服务

```bash
pnpm run start:dev   # 开发模式（热重载）
# 或
pnpm run start
```

默认监听 `3001` 端口，可用环境变量 `PORT` 覆盖。

### 3. 探活

```bash
curl http://localhost:3001
# {"code":200,"data":"Hello World!","message":"成功"}
```

## 接口说明

所有响应统一为 `{ code, data, message }`。

### 用户管理（`/user`）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/user` | 无 | 创建用户（body: `username/name/age`，角色固定 `user`） |
| `GET` | `/user` | 无 | 查询全部 |
| `GET` | `/user/age-demo?age=25` | 无 | Pipe 演示：age 字符串转数字并校验 0~150 |
| `GET` | `/user/:id` | Bearer | 按 ID 查询；普通用户只能查自己 |
| `PATCH` | `/user/:id` | Bearer | 部分更新；普通用户只能改自己 |
| `DELETE` | `/user/:id` | 无 | 删除（演示 Pipe 独立拦截非法 id） |

### JWT 演示（`/jwt-test`）

> 运转原理（签发 → 携带 → 验签、payload 为何是明文）见上文「JWT 认证机制」章节。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/jwt-test/sign` | body 传 `{ sub, username }` 签发 JWT，返回 `{ access_token }` |
| `GET` | `/jwt-test/verify` | 携带 `Authorization: Bearer <token>` 验签并还原载荷 |

## curl 示例

```bash
# 1. 无 Token 访问受保护接口 → 401
curl http://localhost:3001/user/2

# 2. 普通用户（user-token-456）查自己 → 200
curl -H "Authorization: Bearer user-token-456" http://localhost:3001/user/2

# 3. 普通用户查他人（id=1）→ 403 越权
curl -H "Authorization: Bearer user-token-456" http://localhost:3001/user/1

# 4. 管理员（admin-token-123）查任意用户 → 200
curl -H "Authorization: Bearer admin-token-123" http://localhost:3001/user/2

# 5. Pipe：age 字符串转数字 → {"age":25,"type":"number"}
curl "http://localhost:3001/user/age-demo?age=25"

# 6. Pipe：非法 ID → 400（DELETE 无 Guard，由 Pipe 拦截）
curl -X DELETE http://localhost:3001/user/abc

# 7. 用户不存在 → 404
curl -H "Authorization: Bearer admin-token-123" http://localhost:3001/user/999

# 8. JWT 签发 → 验签闭环
curl -X POST http://localhost:3001/jwt-test/sign \
  -H "Content-Type: application/json" \
  -d '{"sub": 1, "username": "admin"}'
# → {"access_token":"eyJhbGciOiJIUzI1NiIs..."}

curl http://localhost:3001/jwt-test/verify \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
# → {"sub":1,"username":"admin","iat":...,"exp":...}
```

## 演示对照速查

| 概念 | 本项目的体现 | 关键点 |
|---|---|---|
| `@Global()` 全局模块 | `auth/auth.module.ts` | 导出 `AuthService`，全应用免 import 注入 |
| Guard（守卫） | `common/guards/auth.guard.ts` | 鉴权 + 越权，写入 `request.user` |
| Pipe（管道） | `common/pipes/*.ts` | 参数进 Controller 前先转换 / 校验 |
| Filter（过滤器） | `common/filters/all-exceptions.filter.ts` | 异常统一 `{code,data,message}` |
| Interceptor（拦截器） | `common/interceptors/transform.interceptor.ts` | 成功响应统一外壳 + 耗时日志 |
| 参数装饰器 | `common/decorators/current-user.decorator.ts` | `@CurrentUser()` 取 `request.user` |
| 全局 JWT | `app.module.ts` + `jwt-test/` | `JwtModule.register({ global: true })` |
| DTO 部分更新 | `user/dto/update-user.dto.ts` | `PartialType(CreateUserDto)` 全字段可选 |

## 运行测试

```bash
pnpm test          # 单元测试
pnpm run test:e2e  # e2e 测试（需先启动服务）
```
