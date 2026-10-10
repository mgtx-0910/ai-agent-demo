# knowledge-hub-frontend

`knowledge-hub-backend` 的 React 管理台：文档生命周期、全文检索、RAG 问答、知识图谱与 RBAC 管理界面。

> 前端只负责体验层。**真正的权限与可见性拦截在后端**（见 backend README「认证与权限」），前端隐藏菜单/路由只是减少误操作。

## 技术栈

| 领域 | 选型 |
|---|---|
| 框架 | React 19 + TypeScript 6 + Vite 8 |
| UI | Ant Design 6（`zh_CN` 本地化）、`@ant-design/icons` |
| 路由 | React Router 7 |
| AI 流式 | AI SDK v7（`@ai-sdk/react` 的 `useChat` + `ai` 的 `DefaultChatTransport`） |
| 图表 | ECharts 6（知识图谱力导向布局） |
| Markdown | react-markdown + remark-gfm |
| Lint | oxlint |

## 本地运行

后端先起在 `http://localhost:3000`（含基础设施，见 backend README）。

```bash
cd knowledge-hub-frontend
npm install
npm run dev        # http://localhost:5173
```

| 预置账号 | 密码 | 可见范围 |
|---|---|---|
| `admin` | `123456` | 全部菜单（含系统管理、审核工作台） |
| `reviewer` | `123456` | 文档 + 检索 + 问答 + 图谱 + 审核工作台 |
| `user` | `123456` | 文档 + 检索 + 问答 + 图谱 + 个人中心 |

其他脚本：`npm run build`（`tsc -b` + 打包）、`npm run lint`（oxlint）、`npm run preview`。

## 与后端如何对接

```
浏览器 ──► Vite dev server :5173 ──/api/*──► http://127.0.0.1:3000/*
                                   （rewrite 去掉 /api 前缀）
```

- 代理配置在 `vite.config.ts`：`/api` → `127.0.0.1:3000`，`changeOrigin: true`，并把超时设为 `0`（问答是长连接流，必须关掉代理超时）。
- 后端没有全局路由前缀，所以 `rewrite` 会把 `/api` 摘掉；`.env` 里只放 `VITE_API_BASE=/api` 一项。
- 仓库根 `.gitignore` 第 4 行忽略了 `.env`，所以 clone 后本地并无该文件；`client.ts` 用 `import.meta.env.VITE_API_BASE || '/api'` 兜底，默认仍走 `/api` 代理。要指向其它后端时，自己新建 `.env` 覆盖。
- 生产部署没有内置反代：需要把 `/api` 指向后端，或改 `VITE_API_BASE` 为后端完整地址。

## 页面与路由

`src/App.tsx` 用两个小包装组件控制访问：`Guard`（是否登录）与 `Perm`（是否具备权限码）。

| 路由 | 页面文件 | 进入条件 | 说明 |
|---|---|---|---|
| `/login` | `pages/LoginPage.tsx` | 公开 | 登录；已登录则跳首页 |
| `/dashboard` | `pages/DashboardPage.tsx` | 登录 | 工作概览 |
| `/documents` | `pages/DocumentsPage.tsx` | `document:list` | 可见文档列表（可见性由后端过滤） |
| `/documents/new` | `pages/DocumentEditPage.tsx` | `document:create` | 新建 + 上传解析 |
| `/documents/:id/edit` | `pages/DocumentEditPage.tsx` | `document:edit` | 编辑元数据 |
| `/documents/:id` | `pages/DocumentDetailPage.tsx` | `document:list` | 详情与发布/归档/下架等动作 |
| `/search` | `pages/SearchPage.tsx` | `search` | 全文检索（ES 高亮 + 分页） |
| `/chat` | `pages/ChatPage.tsx` | `search` | 流式 RAG 问答，`?session=` 指定会话 |
| `/graph` | `pages/GraphPage.tsx` | `search` | 图谱全景 / 实体检索 |
| `/profile` | `pages/ProfilePage.tsx` | `profile` | 资料、改密 |
| `/admin/users` | `pages/admin/UsersPage.tsx` | `ROLE_ADMIN` | 用户 CRUD、分配角色 |
| `/admin/roles` | `pages/admin/RolesPage.tsx` | `ROLE_ADMIN` | 角色与权限树勾选 |
| `/admin/teams` | `pages/admin/TeamsPage.tsx` | `ROLE_ADMIN` | 团队树与成员维护 |
| `/admin/reviews` | `pages/admin/ReviewsPage.tsx` | `ROLE_ADMIN` 或 `ROLE_REVIEWER` | 审核工作台（通过/驳回） |

未知路径回落到 `/dashboard`（未登录则 `/login`）。侧边栏与顶栏由 `layouts/AppLayout.tsx` 按同一套规则动态生成。

## 权限控制

```
can(user, code)  → ROLE_ADMIN 直接放行，其余查 user.permissions
isAdmin / isReviewer  → 角色判断（审核工作台入口）
canWriteDocument(user, doc) → 管理员或文档作者
```

- `Perm` 不通过就跳 `/dashboard`；菜单项用同样的 `can()` 决定显不显示。
- 前端拿到的 `roles` / `permissions` 来自 `/auth/me` 与登录响应，登录后每次进入布局都会重新拉一次 `/auth/me` 刷新，避免权限变更后菜单过期。
- 文档可见性标签（公开 / 团队可见 / 仅自己）来自 `utils.visibilityMeta()`，仅作展示，真实过滤在后端。

## 认证与会话

| 项 | 实现 |
|---|---|
| 存储 | `localStorage`：`kh_access_token` / `kh_refresh_token` / `kh_user` |
| 请求头 | `src/api/client.ts` 统一注入 `Authorization: Bearer`；`FormData` 不覆盖 `Content-Type` |
| 401 恢复 | 先 `POST /auth/refresh` 换新 token 再重放原请求（只重试一次）；`refreshing` 单飞，并发 401 只触发一次刷新 |
| 刷新失败 | `clearAuth()` 并跳登录，提示「未登录或登录已过期」 |
| 登录态订阅 | `src/auth.ts` 用 `useSyncExternalStore` 暴露 `useAuth()`，token 变化即刷新菜单与守卫 |
| 登出 | 调 `POST /auth/logout` 后清本地（接口失败也清） |
| 错误提示 | `ApiError` 解析后端 `message`（数组则用「；」连接）；ES 高亮经 `safeHighlight` 转义后再放行 `<em>`，防 XSS |

## AI 问答（流式）

`ChatPage.tsx` 没有用后端封装的 `/ai/chat`，而是直接接流式接口：

```
useChat({ id: 'kh-chat', transport: new DefaultChatTransport({ api: '/api/ai/chat/stream', headers }) })
   │  headers() 每轮动态取 accessToken
   ▼
POST /ai/chat/stream（AI SDK UI Message Stream 协议）
   │
   ├─ onData: data-session  → 把 sessionId 写进地址栏 ?session=xxx
   ├─ onFinish: 重新拉会话列表（标题可能已被生成）
   └─ onError: 提示错误
```

- `id` 固定为 `kh-chat`，所以在页面间切换时同一条流不会中断。
- 历史会话回放：`GET /ai/sessions/:id/messages` → `historyToUIMessages()` 还原成 UIMessage（含 `sources`）。
- 流式期间禁用「新对话 / 切换 / 删除」，并提供「停止」按钮中断本次生成。

### 消息渲染

`components/ChatMessageParts.tsx` 按 part 类型分派：

| part | 展示 |
|---|---|
| `reasoning` / `data-think` | 思考过程（连续片段合并，流式时带状态） |
| `text` | Markdown 正文；`stripInternalToolJson()` 过滤评估/改写模型吐出的内部 JSON |
| `data-sources` | 引用资料；`citedSources()` 只保留正文里真正标了 `[n]` 的，避免无关召回占位 |
| `data-intent` | 意图分类结果（本轮开哪些工具：知识库 / 图谱 / 联网） |
| `data-retrieve` | 检索命中片段 |
| `data-graph` | 图谱子图，内嵌力导向小图 |
| `data-eval` | 切题评估与是否改写重查 |
| `data-status` | 阶段状态文案 |
| `source-document` / `source-url` | 文档来源 / 联网来源 |

即：**回答正文之外，整条「意图 → 检索 → 图谱 → 评估」的推理轨迹都是可见的**，便于判断答案依据。

滚动行为：贴底时自动跟随，用户上滑即解锁并出现「回到底部」，避免流式输出抢滚动位置。

## 知识图谱可视化

`components/ForceGraph.tsx` 用 ECharts 的 graph 力导向实现，图谱页与问答内的检索轨迹图共用：

| 元素 | 取值 |
|---|---|
| 节点 kind | `document` / `entity` / `tag` |
| 边 kind | `mentions`（文档—实体）/ `related`（实体—实体）/ `tagged` |

## 目录结构

```text
src/
├── api/
│   ├── client.ts            # fetch 封装、Bearer 注入、401 自动刷新重放
│   └── index.ts             # 按域分组的接口：auth/document/search/ai/graph/user/role/permission/team
├── auth.ts                  # localStorage 三键 + useSyncExternalStore 登录态
├── types.ts                 # 后端返回结构（AuthUser/DocumentItem/ChunkHit/ChatResult/GraphOverview…）
├── utils.ts                 # 状态字典、时间格式化、can/isAdmin、canWriteDocument、safeHighlight
├── App.tsx                  # 路由表 + Guard/Perm
├── main.tsx                 # ConfigProvider(zh_CN) + BrowserRouter
├── index.css                # 全部自定义样式（含对话、图谱、轨迹面板）
├── components/
│   ├── ChatMessageParts.tsx # 流式消息与检索轨迹渲染（最大的一块逻辑）
│   ├── SourceCiteList.tsx   # 引用列表 + Markdown 正文渲染
│   ├── ForceGraph.tsx       # ECharts 力导向图
│   ├── FileTypeIcon.tsx     # 文档类型图标
│   └── BrandLogo.tsx
├── layouts/AppLayout.tsx    # 顶栏 + 侧边栏，按权限动态生成菜单
├── pages/                   # 各页面（含 admin/ 四个管理页）
└── assets/
```

## 已知限制与后续

1. **token 存 localStorage**，存在 XSS 窃取风险；更稳的方案是 httpOnly Cookie + CSRF 防护。
2. **无自动化测试**，目前只有 oxlint 静态检查与手工验证。
3. `.env` 被仓库根 `.gitignore` 忽略，本地配置不会入库；新增环境变量时记得同步更新本文件的说明。
4. 问答流未做断线重连：网络中断只能重新提问（历史已落库，不影响会话记录）。
5. 审核无实时通知：顶栏铃铛是静态入口，待办数量需进页面刷新。
