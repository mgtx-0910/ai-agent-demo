# Neo4j GraphRAG

基于 **Neo4j 知识图谱 + LangChain.js + LangGraph** 的图检索增强生成（GraphRAG）示例：以「奶茶知识图谱」为数据，演示 **LLM 生成 Cypher → 图谱查询 → 生成回答** 的完整链路，并配套 Neo4j 基础操作示例与 Cypher 实战笔记。

## 项目简介

传统向量 RAG 靠**语义相似度**召回文本片段；本项目换一种思路——把知识存成**图结构**（节点 + 关系），让 LLM 先把自然语言问题转成 **Cypher 查询语句**，去图谱里精确检索"结构化事实"，再基于检索结果生成回答。

```
用户问题 ──▶ LLM 生成 Cypher ──▶ Neo4j 执行查询 ──▶ LLM 生成回答
```

适合回答「珍珠奶茶有哪些配料」「台式奶茶属于什么类型」这类**关系明确、需要多跳**的问题，不会像纯向量检索那样把相似但不相关的内容混进来。

## 项目结构

```
neo4j-graphrag/
├── src/
│   ├── graphrag.mjs      # GraphRAG 工作流：生成 Cypher → 图查询 → 生成答案（LangGraph）
│   └── neo4j-test.mjs    # Neo4j 基础操作演示：增 / 删 / 改 / 查（neo4j-driver 直连）
├── cypher.md             # Cypher 实战笔记①：建节点、建关系、多跳查询（也是图谱种子数据来源）
├── cypher2.md            # Cypher 实战笔记②：更新属性、删除关系 / 节点
├── docker-compose.yml    # Neo4j 一键启动（含 APOC 插件）
├── .env.example          # 环境变量示例
└── package.json
```

## 图谱 Schema

| 节点 | 含义 | 示例 |
| --- | --- | --- |
| `Product` | 奶茶产品 | 珍珠奶茶 |
| `Type` | 奶茶类型 | 台式奶茶、港式奶茶 |
| `Ingredient` | 配料 | 珍珠、红茶、牛奶、果糖 |
| `Method` | 制作工艺 | 煮制、冲泡 |
| `People` | 适合人群 | 年轻人、学生、甜食爱好者 |

关系方向（必须严格遵守，LLM 生成 Cypher 时也会按此约束）：

```
(Product)-[:属于]->(Type)
(Product)-[:包含]->(Ingredient)
(Product)-[:适合]->(People)
(Ingredient)-[:使用]->(Method)
```

## 前置依赖

1. **Docker**（用于启动 Neo4j，`neo4j:latest` 镜像）
2. **Node.js 18+**
3. **兼容 OpenAI 协议的模型服务**（如阿里云百炼 DashScope），用于生成 Cypher 与最终回答
4. 图谱数据：先按 `cypher.md` / `cypher2.md` 里的语句灌入节点与关系（或运行 `neo4j-test.mjs` 的示例操作）

## 快速开始

### 1. 启动 Neo4j

```bash
docker compose up -d
```

- Web 管理界面：http://localhost:7474 （浏览器访问，账号 `neo4j` / 密码 `12345678`）
- Bolt 连接地址：`bolt://localhost:7687`（代码连接用）

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写：

```bash
OPENAI_API_KEY=sk-xxx                 # 模型服务 API Key
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
RERANK_URL=https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank
MODEL_NAME=qwen-plus                  # 生成 Cypher / 回答的模型
```

### 3. 安装依赖

```bash
npm install
```

### 4. 灌入图谱数据

在 Neo4j Browser（http://localhost:7474）中依次执行 `cypher.md` 的语句，建立奶茶知识图谱的节点与关系；或用 `neo4j-test.mjs` 逐步演示增删改查。

### 5. 运行示例

```bash
# Neo4j 基础操作演示（默认执行查询）
node src/neo4j-test.mjs

# GraphRAG 工作流：打印 Mermaid 图 → 生成 Cypher → 图查询 → 生成回答
node src/graphrag.mjs
```

## GraphRAG 工作流详解

三个节点线性串联（LangGraph 状态机）：

```
START → generateCypher → executeGraph → generateAnswer → END
```

| 节点 | 作用 | 输入 → 输出 |
| --- | --- | --- |
| `generateCypher` | LLM 把问题转成纯 Cypher 语句 | 用户问题 → `cypher` |
| `executeGraph` | 执行 Cypher，取回图谱检索结果 | `cypher` → `context`（JSON） |
| `generateAnswer` | 基于检索结果生成最终回答 | `context` + 问题 → `answer` |

关键设计：

- **生成 Cypher 时把图谱 Schema 写进 prompt**：节点标签、关系方向、生成规则都作为约束传给 LLM，降低"关系方向写反""多跳路径连错"的概率
- **查询失败有兜底**：`executeGraph` 捕获异常并返回 `未查询到相关知识`，避免一条坏 Cypher 中断整个流程
- **回答只依赖图谱事实**：prompt 明确要求不推断、不编造图谱中未出现的配料
- **`temperature=0`**：图谱问答追求事实准确，关闭模型随机性
- **并发安全**：`Promise.all` 并发调用同一个 `app`，LangGraph 每次 `invoke` 都是独立状态副本

## 技术要点

- **Neo4jGraph 封装**：`@langchain/community/graphs/neo4j_graph` 提供图数据库连接与 Cypher 执行能力，并自动刷新图谱 Schema 缓存
- **neo4j-driver 直连**：`neo4j-test.mjs` 演示最底层的 driver / session / run 用法，与 LangChain 封装相互对照
- **APOC 插件**：docker-compose 中已启用，供后续扩展图算法等高级能力
- **LangGraph 状态机制**：`channels` 声明各字段的合并策略（`messages` 追加式、其余覆盖式），节点返回的字段名必须与状态声明一致，否则被静默丢弃

## 依赖

- `neo4j-driver` — Neo4j 官方驱动（Bolt 协议直连）
- `@langchain/community` — Neo4j 图封装
- `@langchain/openai` — OpenAI 兼容模型
- `@langchain/langgraph` — 状态图编排
- `dotenv` — 环境变量加载
