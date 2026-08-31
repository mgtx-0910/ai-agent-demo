# prompt-template-test

LangChain **Prompt 模板** 系列测试，以「生成技术周报」为核心场景，系统覆盖各类提示词模板的用法：基础模板、聊天模板、Few-shot、示例选择器、占位符、流水线模板、变量预填等。

## 项目结构

```
prompt-template-test/
└── src/
    ├── prompt-template1.mjs                  # 基础：PromptTemplate 字符串模板
    ├── chat-prompt-template.mjs              # ChatPromptTemplate 内联多角色消息
    ├── chat-prompt-template2.mjs             # 进阶：拆分 System/HumanMessagePromptTemplate 复用
    ├── fewshot-prompt-template.mjs           # 基础 Few-shot：手动指定 examples
    ├── fewshot-chat-prompt-template.mjs      # 聊天格式 Few-shot：input/output → human/ai
    ├── example-selector1.mjs                 # LengthBasedExampleSelector 按长度截断选例
    ├── example-selector2.mjs                 # SemanticSimilarityExampleSelector + Milvus 语义选例
    ├── messages-placeholder.mjs              # MessagesPlaceholder 预留 {history} 动态注入历史
    ├── pipeline-prompt-template.mjs          # PipelinePromptTemplate 模块化组合（persona/context/task/format）
    ├── pipeline-prompt-template2.mjs         # 复用模块 + 替换 finalPrompt（季度 OKR 邮件场景）
    ├── pipeline-prompt-template3.mjs         # 聊天格式 Pipeline（ChatPromptTemplate 作 finalPrompt）
    ├── partial.mjs                           # .partial() 预填固定变量，暴露业务变量
    └── weekly-report-examples-writer-milvus.mjs  # 数据准备：周报示例向量化写入 Milvus
```

## 主题速览

| 主题 | 代表文件 | 说明 |
| --- | --- | --- |
| 基础模板 | `prompt-template1.mjs` | `PromptTemplate.fromTemplate` + `.format()` |
| 聊天模板 | `chat-prompt-template*.mjs` | system/human 多角色消息 |
| Few-shot | `fewshot-*.mjs` | 示例引导模型模仿格式 |
| 示例选择 | `example-selector*.mjs` | 按长度 / 按语义相似度（Milvus）自动选例 |
| 占位符 | `messages-placeholder.mjs` | 多轮对话历史注入 |
| Pipeline 模板 | `pipeline-prompt-template*.mjs` | Prompt 模块化组合与复用 |
| 变量预填 | `partial.mjs` | `.partial()` 固化不变部分 |

## 快速开始

### 1. 前置依赖

- Node.js 18+
- 可访问的 OpenAI 兼容模型端点
- **Milvus**（`example-selector2.mjs`、`weekly-report-examples-writer-milvus.mjs` 需要）

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

# 建议先运行数据准备脚本（语义选择器需要）
node src/weekly-report-examples-writer-milvus.mjs

# 逐个运行示例
node src/prompt-template1.mjs
node src/chat-prompt-template.mjs
node src/fewshot-prompt-template.mjs
node src/example-selector1.mjs
node src/example-selector2.mjs
node src/messages-placeholder.mjs
node src/pipeline-prompt-template.mjs
node src/partial.mjs
```

## 依赖

- `@langchain/core` — Prompt 模板、MessagesPlaceholder 等核心组件
- `@langchain/community` — Milvus 向量库（语义示例选择）
- `@langchain/openai` — 模型与嵌入
