# milvus-test

基于 **Milvus 向量数据库** 的实践测试项目，覆盖向量库的增删改查、语义搜索与 RAG（检索增强生成）问答，包含两套数据场景：

- **AI 日记**（`ai_diary` 集合）：模拟日记数据的入库、检索、问答
- **《天龙八部》**（`ebook_collection` 集合）：EPUB 电子书入库后的小说语义搜索与剧情问答

项目根目录的 `天龙八部.epub` 是电子书入库的数据源。

## 项目结构

```
milvus-test/
├── 天龙八部.epub                # 电子书数据源
└── src/
    ├── insert.mjs               # 创建 ai_diary 集合（IVF_FLAT 索引）+ 批量插入 5 条日记
    ├── query.mjs                # 自然语言 → 向量 → 余弦相似度 TopK 检索
    ├── update.mjs               # upsert 更新向量（主键相同覆盖并重新向量化）
    ├── delete.mjs               # 三种删除方式（按主键 / 批量 / 条件过滤）
    ├── rag.mjs                  # 基于 ai_diary 的完整 RAG 日记问答（检索→增强→生成）
    ├── ebook-writer.mjs         # EPUB 解析（EPubLoader）→ 分章切块 → 向量化流式入库（断点续传）
    ├── ebook-query.mjs          # 《天龙八部》纯向量语义搜索，返回最相关小说片段
    └── ebook-reader-rag.mjs     # 《天龙八部》RAG 问答，依据小说原文回答
```

## 快速开始

### 1. 前置依赖

- Node.js 18+
- 本地 Milvus（默认 `localhost:19530`）
- 可访问的 OpenAI 兼容模型端点（`text-embedding-v3` 嵌入，维度 1024）

### 2. 环境配置

项目使用 `dotenv` 加载 `.env`：

```bash
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen-plus
```

### 3. 安装与运行

```bash
npm install   # 或 pnpm install

# 场景一：AI 日记（按顺序执行）
node src/insert.mjs     # 建集合并写入数据
node src/query.mjs      # 语义检索
node src/update.mjs     # 更新
node src/delete.mjs     # 删除
node src/rag.mjs        # RAG 问答

# 场景二：《天龙八部》
node src/ebook-writer.mjs    # EPUB 入库（耗时较长，支持断点续传）
node src/ebook-query.mjs     # 语义搜索
node src/ebook-reader-rag.mjs  # RAG 问答
```

## 技术要点

- **索引类型**：`ai_diary` 使用 IVF_FLAT；`ebook_collection` 使用 HNSW（M=16, efConstruction=200）
- **相似度度量**：余弦距离（COSINE）
- **向量维度**：1024，须与 Milvus 建集合时一致
- **断点续传**：`ebook-writer.mjs` 按主键判断已入库章节，可中断后重跑
