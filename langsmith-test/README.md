# LangSmith Test

基于 **LangGraph + Milvus + LangSmith** 的 RAG 问答与评测示例：把客服知识文档写入 Milvus，用 LangGraph 搭出「检索 → 生成」的 RAG Agent，再通过 LangSmith + OpenEvals 对它做**忠实度 / 有用性 / 检索相关性**三项自动评测。

## 项目结构

```
langsmith-test/
├── src/
│   ├── cli.mjs                # RAG 问答 CLI 入口（支持自定义问题与默认示例）
│   ├── milvus_insert.mjs      # 数据入库：切块 → 向量化 → 建集合 → 写入 Milvus
│   ├── rag_agent.mjs          # 核心 Agent：LangGraph 状态图（retrieve → generate）
│   └── eval/
│       ├── build_dataset.mjs  # 构建 LangSmith 评测数据集（问题 + 标准答案）
│       ├── evaluators.mjs     # OpenEvals 三个 RAG 评测器
│       └── run_eval.mjs       # 评测入口：跑数据集 → LLM-as-Judge 打分 → 上报 LangSmith
├── data/                      # 客服知识文档（入库数据源）
│   ├── sample.txt             # 售后总则 / 退换货 / 运费 / 客服投诉
│   ├── membership.md          # 会员权益 / 积分
│   ├── payment.md             # 支付方式 / 发票
│   ├── product_warranty.md    # 商品保修
│   └── shipping.md            # 物流发货 / 包邮
├── docker-compose.yml         # Milvus 全家桶（etcd + minio + milvus standalone）
├── .env.example               # 环境变量示例
└── package.json
```

## 前置依赖

1. **Node.js 18+**
2. **Milvus 向量数据库**：`docker compose up -d`（默认 `localhost:19530`）
3. **兼容 OpenAI 协议的模型服务**（如阿里百炼），提供生成/评测模型
4. **LangSmith 账号与 API Key**（评测链路需要，仅做追踪时也建议开启）

## 环境配置

复制 `.env.example` 为 `.env` 并填写：

```bash
# 模型服务
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen-plus

# Milvus
MILVUS_URI=http://localhost:19530
MILVUS_COLLECTION=rag_docs

# Embedding
EMBEDDING_MODEL=text-embedding-v3

# LangSmith（评测/追踪）
LANGCHAIN_API_KEY=xxx
LANGCHAIN_PROJECT=langsmith-test
LANGCHAIN_TRACING_V2=true
```

## 运行

```bash
# 1. 安装依赖
npm install

# 2. 启动 Milvus（首次）
docker compose up -d

# 3. 把 data/ 文档写入 Milvus（集合不存在会自动创建）
npm run insert

# 4. 问答测试（不传参跑默认示例，传参问自定义问题）
npm run ask
npm run ask -- 手机保修多久？

# 5. 构建评测数据集（写入 LangSmith，存在则复用）
npm run eval:dataset

# 6. 运行评测（数据集 + RAG Agent + 三个评测器 → 结果上报 LangSmith）
npm run eval:run
```

## 评测指标

使用 OpenEvals 内置 RAG 提示词，以 LLM-as-Judge（连续评分）方式打分：

| 指标 | 含义 | 判断内容 |
| --- | --- | --- |
| `rag_groundedness` | 忠实度 | 回答是否被检索上下文支撑，有无幻觉 |
| `rag_helpfulness` | 有用性 | 是否切题、答非所问 |
| `rag_retrieval_relevance` | 检索相关性 | 召回片段与问题是否相关 |

评测完成后控制台会输出实验名与指标名，完整报告在 LangSmith 控制台查看：

```
https://smith.langchain.com/o/default/projects/p/<LANGCHAIN_PROJECT>
```

## 数据说明

`data/` 目录的文档为虚构的电商客服知识库（场景说明用），按主题拆分为多个 `.md/.txt` 文件，入库时由 `RecursiveCharacterTextSplitter` 切块（chunkSize=500、chunkOverlap=50），块数较少适合快速跑通全链路。

## 技术要点

- **LangGraph 状态图**：`retrieve → generate` 直线流程，`Annotation.Root` 声明状态字段，节点返回增量更新
- **Milvus 集成**：入库用 `@zilliz/milvus2-sdk-node` 原生 SDK；查询用 `@langchain/community` 的 `Milvus` vectorstore（`k=4` 召回）
- **LangSmith 评测**：`evaluate()` 接受「被测函数 + 数据集 + 评测器数组」，每次运行生成一个 experiment，便于对比不同模型/参数
- **评测模型复用生成模型**：Judge 默认用 `MODEL_NAME`（qwen-plus），也可单独换更强的模型评测

## 依赖

- `@langchain/langgraph` / `@langchain/core` / `@langchain/openai` — 编排与模型接入
- `@langchain/community` — Milvus 向量库集成
- `@zilliz/milvus2-sdk-node` — Milvus 原生客户端
- `@langchain/textsplitters` — 文档切块
- `langsmith` — LangSmith 数据集与评测
- `openevals` — LLM-as-Judge 评测器
- `dotenv` — 环境变量加载
