# output-parser-test

LangChain **输出解析 / 结构化输出** 系列测试，系统对比了让模型返回结构化数据的各种实现方式——从手动解析到内置 Parser，从普通输出到流式，从 JSON 到 XML 再到 Tool Calls，并在 `test/` 给出工具定义与 AI + MySQL 实战应用。

## 项目结构

```
output-parser-test/
└── src/
    ├── normal.mjs                          # 基础：手动要求 JSON + JSON.parse
    ├── json-output-parser.mjs              # JsonOutputParser 自动提取解析 JSON
    ├── structured-output-parser.mjs        # StructuredOutputParser（fromNamesAndDescriptions）
    ├── structured-output-parser2.mjs       # StructuredOutputParser（fromZodSchema 复杂嵌套）
    ├── structured-json-schema.mjs          # Zod → JSON Schema，模型原生 json_schema 模式输出
    ├── with-structured-output.mjs          # withStructuredOutput 最简结构化调用
    ├── xml-output-parser.mjs               # XMLOutputParser 返回并解析 XML
    ├── stream-normal.mjs                   # 普通流式输出
    ├── stream-structured-partial.mjs       # 流式 + 结束后结构化解析
    ├── stream-with-structured-output.mjs   # 流式直接产出结构化对象
    ├── stream-tool-calls-raw.mjs           # 流式 tool_call_chunks 原始解析
    ├── stream-tool-calls-parser.mjs        # JsonOutputToolsParser 增量解析流式 tool_calls
    ├── tool-calls-args.mjs                 # 非流式 Tool Calls：bindTools + args
    └── test/                               # 实战应用
        ├── all-tools.mjs                   #   定义 4 个工具（读写文件/执行命令/列目录）
        ├── create-table.mjs                #   MySQL 建库建表脚本
        ├── mini-cursor.mjs                 #   Mini Agent：ReAct 循环自动创建 React 项目
        └── smart-import.mjs                #   自然语言 → 结构化提取 → 批量写 MySQL
```

## 实现方式对比

| 方式 | 代表文件 | 特点 |
| --- | --- | --- |
| 手动 `JSON.parse` | `normal.mjs` | 无依赖，需自行处理格式漂移 |
| `JsonOutputParser` | `json-output-parser.mjs` | 自动提取 JSON |
| `StructuredOutputParser` | `structured-output-parser*.mjs` | 键值对 / Zod Schema 两种定义方式 |
| 原生 JSON Schema | `structured-json-schema.mjs` | 模型 `response_format` 直接约束 |
| `withStructuredOutput` | `with-structured-output.mjs` | 最简洁，直接得到对象 |
| Tool Calls | `tool-calls-args.mjs` 等 | 以工具参数形式返回结构化数据 |
| 流式变体 | `stream-*.mjs` | 边生成边解析 / 结束后解析 |
| XML | `xml-output-parser.mjs` | XML 格式输出 |

## 快速开始

### 1. 前置依赖

- Node.js 18+
- 可访问的 OpenAI 兼容模型端点

### 2. 环境配置

项目使用 `dotenv` 加载 `.env`：

```bash
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen-plus
```

> `test/smart-import.mjs` 需要额外配置 MySQL 连接参数。

### 3. 安装与运行

```bash
npm install

# 逐个运行示例
node src/normal.mjs
node src/json-output-parser.mjs
node src/with-structured-output.mjs
node src/xml-output-parser.mjs
node src/stream-normal.mjs
node src/stream-tool-calls-parser.mjs
# ...
```

## 依赖

- `@langchain/openai` / `@langchain/core` — 模型与 Parser
- `zod` / `zod-to-json-schema` — Schema 定义与转换
- `mysql2` — MySQL 实战写入
- `chalk` — 终端美化输出
