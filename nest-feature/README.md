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

## 请求生命周期（本项目覆盖了哪几步）

```
请求进入
  → ① Interceptor（TransformInterceptor：打请求日志）
  → ② Guard（AuthGuard：鉴权 → 越权判断 → 写 request.user）
  → ③ Pipe（ParsePositiveIntPipe / ParseAgePipe：参数转换 + 校验）
  → ④ Controller 处理（@CurrentUser() 取登录用户）
  → ⑤ Service 业务逻辑
  → ⑥ 成功：回到 ① 的 Interceptor 包 { code:200, data }
      失败：抛出的异常被 Filter 统一格式化成 { code, data:null, message }
```

> 路由上无 Guard 的接口（POST/GET 列表、DELETE）会跳过 ②；有 Pipe 的参数仍会被 ③ 校验。

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

默认监听 `3000` 端口，可用环境变量 `PORT` 覆盖。

### 3. 探活

```bash
curl http://localhost:3000
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

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/jwt-test/sign` | body 传 `{ sub, username }` 签发 JWT，返回 `{ access_token }` |
| `GET` | `/jwt-test/verify` | 携带 `Authorization: Bearer <token>` 验签并还原载荷 |

## curl 示例

```bash
# 1. 无 Token 访问受保护接口 → 401
curl http://localhost:3000/user/2

# 2. 普通用户（user-token-456）查自己 → 200
curl -H "Authorization: Bearer user-token-456" http://localhost:3000/user/2

# 3. 普通用户查他人（id=1）→ 403 越权
curl -H "Authorization: Bearer user-token-456" http://localhost:3000/user/1

# 4. 管理员（admin-token-123）查任意用户 → 200
curl -H "Authorization: Bearer admin-token-123" http://localhost:3000/user/2

# 5. Pipe：age 字符串转数字 → {"age":25,"type":"number"}
curl "http://localhost:3000/user/age-demo?age=25"

# 6. Pipe：非法 ID → 400（DELETE 无 Guard，由 Pipe 拦截）
curl -X DELETE http://localhost:3000/user/abc

# 7. 用户不存在 → 404
curl -H "Authorization: Bearer admin-token-123" http://localhost:3000/user/999

# 8. JWT 签发 → 验签闭环
curl -X POST http://localhost:3000/jwt-test/sign \
  -H "Content-Type: application/json" \
  -d '{"sub": 1, "username": "admin"}'
# → {"access_token":"eyJhbGciOiJIUzI1NiIs..."}

curl http://localhost:3000/jwt-test/verify \
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
