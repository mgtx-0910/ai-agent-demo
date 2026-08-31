# runnable-test

LangChain **Runnable（可运行组件）体系** 系列测试，先以「手写三步」与 `RunnableSequence` 的对比说明 Runnable 的价值，再逐个讲解核心组件与增强包装，最后通过两个实战案例展示组合应用。

## 项目结构

```
runnable-test/
└── src/
    ├── before.mjs                            # 对照：手动 format→invoke→parse 三步调用
    ├── runnable.mjs                          # 入门：RunnableSequence 串联 prompt→model→parser
    ├── runnables/                            # 核心组件逐个演示
    │   ├── RunnableLambda.mjs                #   普通函数包装为 Runnable 并串联
    │   ├── RunnableMap.mjs                   #   同一输入并行执行多个子 Runnable
    │   ├── RunnablePassthrough.mjs           #   透传输入 + .assign() 追加字段
    │   ├── RunnablePick.mjs                  #   从输入中挑选指定字段
    │   ├── RunnableBranch.mjs                #   条件分支路由（if/else + 默认）
    │   ├── RouterRunnable.mjs                #   按 key 显式路由到对应 Runnable
    │   ├── RunnableEach.mjs                  #   对数组逐元素执行（类似 Array.map）
    │   ├── RunnableWithCallbacks.mjs         #   监听生命周期事件（调试/监控）
    │   ├── RunnableWithConfig.mjs            #   .withConfig 动态读取运行时配置
    │   ├── RunnableWithFallbacks.mjs         #   失败时降级切换备用组件（容灾）
    │   ├── RunnableWithRetry.mjs             #   失败自动重试
    │   └── RunnableWithMessageHistory.mjs    #   自动注入/保存多轮对话历史
    └── cases/                                # 实战案例
        ├── ebook-reader-rag.mjs              #   Runnable 构建完整 RAG 链路（Milvus 检索）
        └── mcp-test.mjs                      #   RunnableBranch 实现 ReAct Agent 决策循环
```

## 组件速览

| 类别 | 组件 | 作用 |
| --- | --- | --- |
| 编排 | `RunnableSequence` | 把多个组件串成流水线 |
| 组合 | `RunnableMap` / `RunnablePassthrough` / `RunnablePick` / `RunnableEach` | 并行执行 / 透传赋值 / 字段挑选 / 逐元素映射 |
| 路由 | `RunnableBranch` / `RouterRunnable` | 按条件 / 按 key 选择执行路径 |
| 增强 | `withCallbacks` / `withConfig` / `withFallbacks` / `withRetry` | 生命周期、配置注入、容灾、重试 |
| 记忆 | `withMessageHistory` | 多轮对话历史自动管理 |
| 工具 | `RunnableLambda` | 任意函数接入 Runnable 链 |

## 快速开始

### 1. 前置依赖

- Node.js 18+
- 可访问的 OpenAI 兼容模型端点
- **Milvus**（`cases/ebook-reader-rag.mjs` 需要，集合 `ebook_collection`）
- MCP 服务器（`cases/mcp-test.mjs` 需要）

### 2. 环境配置

项目使用 `dotenv` 加载 `.env`：

```bash
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen-plus
```

### 3. 安装与运行

```bash
npm install

# 入门对比
node src/before.mjs
node src/runnable.mjs

# 核心组件
node src/runnables/RunnableLambda.mjs
node src/runnables/RunnableMap.mjs
node src/runnables/RunnableBranch.mjs
# ...

# 实战案例
node src/cases/ebook-reader-rag.mjs
node src/cases/mcp-test.mjs
```

## 依赖

- `@langchain/core` — Runnable 体系
- `@langchain/openai` — 模型
- `@langchain/community` — Milvus 向量库
- `@langchain/mcp-adapters` — MCP 客户端
- `zod` / `chalk` — 校验与终端输出
