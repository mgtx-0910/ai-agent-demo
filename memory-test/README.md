# memory-test

LangChain **对话记忆管理** 系列测试，探索 LLM 多轮对话记忆的三种方向：历史持久化（内存/文件）、上下文压缩（截断/摘要总结）、向量检索记忆（RAG）。

## 项目结构

```
memory-test/
├── chat_history.json             # FileSystemChatMessageHistory 持久化产物
└── src/
    ├── history-test.mjs          # 内存历史：InMemoryChatMessageHistory 连续对话
    ├── history-test2.mjs         # 文件历史：FileSystemChatMessageHistory 持久化 + sessionId 隔离
    ├── history-test3.mjs         # 恢复历史：从 JSON 文件按 sessionId 继续对话
    └── memory/                   # 高级记忆策略（依赖 Milvus 向量库）
        ├── insert-conversations.mjs      # 把 5 条模拟对话向量化写入 Milvus
        ├── retrieval-memory.mjs          # RAG 记忆：按语义检索历史 + 新对话写回
        ├── summarization-memory.mjs      # 摘要总结（按消息条数触发）
        ├── summarization-memory2.mjs     # 摘要总结升级版（按 token 数触发，js-tiktoken 精确控制）
        └── truncation-memory.mjs         # 历史截断（按条数 slice / trimMessages 按 token）
```

## 记忆策略总览

| 策略 | 文件 | 说明 |
| --- | --- | --- |
| 内存历史 | `history-test.mjs` | 会话内连续对话，进程退出即丢失 |
| 文件持久化 | `history-test2/3.mjs` | 写入 JSON 文件，`sessionId` 会话隔离，可跨进程恢复 |
| 检索记忆（RAG） | `memory/retrieval-memory.mjs` | 从 Milvus 按语义相似度检索历史片段拼入 prompt，新对话写回积累 |
| 摘要总结 | `memory/summarization-memory*.mjs` | LLM 把旧消息压缩为摘要，仅保留最近 N 条原文；可按条数或 token 数触发 |
| 历史截断 | `memory/truncation-memory.mjs` | 保留最近消息，防止上下文溢出 |

## 前置依赖

- Node.js 18+
- 可访问的 OpenAI 兼容模型端点
- **Milvus 向量数据库**（`localhost:19530`，`memory/` 下脚本需要，集合 `conversations`）

## 环境配置

项目使用 `dotenv` 加载 `.env`（无 `.env.example`，参考其他子项目自行创建）：

```bash
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen-plus
```

## 运行

```bash
npm install

# 基础历史测试
node src/history-test.mjs
node src/history-test2.mjs   # 首次运行写入 chat_history.json
node src/history-test3.mjs   # 从文件恢复继续对话

# 高级记忆策略（需 Milvus）
node src/memory/insert-conversations.mjs   # 先写入种子数据
node src/memory/retrieval-memory.mjs
node src/memory/summarization-memory.mjs
node src/memory/summarization-memory2.mjs
node src/memory/truncation-memory.mjs
```
