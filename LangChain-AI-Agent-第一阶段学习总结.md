# LangChain 整体总结：AI Agent 第一阶段学习完成



## 一、为什么要用 LangChain？

LangChain 部分学完了，我们来整体总结一下。

首先，我们为什么要用 LangChain 这种 AI Agent 开发框架？

市面上有很多大模型，它们的 API 格式整体分为三类：

- **OpenAI**
- **Anthropic（Claude）**
- **Google Gemini**

国产大模型的 API 都兼容 OpenAI 格式。

举个例子，比如 system 消息怎么传。

**OpenAI 格式：**

```json
{
  "model": "gpt-3.5-turbo",
  "messages": [
    {"role": "system", "content": "你是代码助手"},
    {"role": "user", "content": "你好"}
  ]
}
```

放在 `messages` 数组里。

**Anthropic 格式：**

```json
{
  "model": "claude-4.5-opus",
  "system": "你是一个代码助手",
  "messages": [
    {
      "role": "user",
      "content": [{"type": "text", "text": "分析这段代码"}]
    }
  ]
}
```

放在单独的 `system` 字段。

**Gemini 格式：**

```json
{
  "contents": [{
    "role": "user",
    "parts": [{ "text": "解释下这段代码" }]
  }],
  "system_instruction": {
    "parts": [{ "text": "你是一个代码专家" }]
  }
}
```

放在 `system_instruction` 字段。

类似这样的差异挺多，如果直接和具体大模型耦合，那你的代码就没法切换其他模型了。

所以需要一个统一的写法，然后适配不同的大模型。

你如果用 LangChain，就是这样——所有大模型的 API 都实现 `BaseChatModel`：

```js
// 调用方式完全一致，底层差异由各 ChatModel 子类封装
const model = new ChatOpenAI({ modelName: 'gpt-4o' });
const result = await model.invoke('你好');
```

这样调用的时候，API 一样。细节由 `ChatXxx` 去实现。

它们在不同的包里：

- `@langchain/openai` — OpenAI
- `@langchain/google-genai` — Gemini
- `@langchain/deepseek` — DeepSeek
- `@langchain/anthropic` — Anthropic (Claude)

也可能在 `@langchain/community` 包。

有同学说，不对啊，不是说国产大模型都支持 OpenAI 格式么？之前我们也是直接用 `ChatOpenAI` 调用的 `qwen-plus` 之类的模型，为啥还有单独的 ChatModel？

是的，虽然这些模型兼容 OpenAI 格式，但是每个大模型都有一些自己独有的细节，如果想用全部特性，还是要用专门的 ChatModel 类。

所以，**为什么要用 LangChain？** 它可以用统一的 ChatModel API 来调用各种大模型，屏蔽了底层差异。

比如我司项目里就用到了各种大模型，基于 LangChain 可以做到切换各种大模型，代码不变。所以，我们是基于 LangChain 的 API 来学习大模型的特性，而不是直接学某个大模型的特定 API。

通过 `BaseChatModel` 屏蔽了大模型底层差异后，再就是对输入、输出做控制。




## 二、PromptTemplate — 输入控制

这就用到了 PromptTemplate 和 OutputParser 的 API。

我们基于 prompt 来调用大模型。prompt 可能会很复杂，而且会长期迭代，这就需要**组件化管理**，用的时候组合，而且 prompt 里还需要加少量案例（Few Shot）。

所以 LangChain 提供了 PromptTemplate 的 API。

### 2.1 ChatPromptTemplate

通过 `ChatPromptTemplate` 创建 prompt 模板，其中的占位符用的时候传入。

如果是对话记录，通过 `MessagesPlaceholder` 传入：

```js
import { ChatPromptTemplate } from '@langchain/core/prompts';

const chatPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一名资深工程团队负责人，擅长用结构化、易读的方式写技术周报。
写作风格要求：{tone}。`,
  ],
  [
    'human',
    `本周信息如下：
公司名称：{company_name}
团队名称：{team_name}
直接汇报对象：{manager_name}
本周时间范围：{week_range}
本周团队核心目标：{team_goal}
本周开发数据：{dev_activities}`,
  ],
]);

const chatMessages = await chatPrompt.formatMessages({
  tone: '专业、清晰、略带鼓励',
  company_name: '星航科技',
  team_name: '智能应用平台组',
  // ... 其余参数
});
```

### 2.2 PipelinePromptTemplate

多个 PromptTemplate 可以用 `PipelinePromptTemplate` 组合：

```js
import { PipelinePromptTemplate, PromptTemplate } from '@langchain/core/prompts';

// A. 人设模块
export const personaPrompt = PromptTemplate.fromTemplate(
  `你是一名资深工程团队负责人，写作风格：{tone}。\n`
);

// B. 背景模块
export const contextPrompt = PromptTemplate.fromTemplate(
  `公司：{company_name}
部门：{team_name}
直接汇报对象：{manager_name}\n`
);

// C. 任务模块
const taskPrompt = PromptTemplate.fromTemplate(
  `以下是本周团队的开发活动：{dev_activities}\n`
);

// D. 格式模块
const formatPrompt = PromptTemplate.fromTemplate(
  `请用 Markdown 输出周报，结构包含：...\n`
);

// E. 最终组合
const finalPrompt = PromptTemplate.fromTemplate(
  `{persona_block}{context_block}{task_block}{format_block}`
);

export const pipelinePrompt = new PipelinePromptTemplate({
  pipelinePrompts: [
    { name: 'persona_block', prompt: personaPrompt },
    { name: 'context_block', prompt: contextPrompt },
    { name: 'task_block', prompt: taskPrompt },
    { name: 'format_block', prompt: formatPrompt },
  ],
  finalPrompt: finalPrompt,
});
```

指定多个 `pipelinePrompts`，然后指定最终的 `finalPrompt`，这样就是多个 PromptTemplate 合成一个。

### 2.3 FewShotPromptTemplate

有时还需要加入一些示例，用 `FewShotPromptTemplate`：

```js
import { FewShotPromptTemplate, PromptTemplate } from '@langchain/core/prompts';

// 定义单条示例模板
const examplePrompt = PromptTemplate.fromTemplate(
  `用户输入：{user_requirement}
期望周报结构：{expected_style}
模型示例输出片段：{report_snippet}
---`
);

// 准备示例数据
const examples = [
  {
    user_requirement: '重点突出稳定性治理，本周主要在修 Bug 和清理技术债。',
    expected_style: '语气稳健、偏保守，多强调风险识别和已做的兜底动作。',
    report_snippet: `- 支付链路本周共处理线上 P1 Bug 2 个…`,
  },
  {
    user_requirement: '偏向对外展示成果，希望多写一些亮点。',
    expected_style: '语气积极、突出成果，对技术细节做适度抽象。',
    report_snippet: `- 新上线「订单实时看板」…`,
  },
];

// 封装成 FewShotPromptTemplate
const fewShotPrompt = new FewShotPromptTemplate({
  examples,
  examplePrompt,
  prefix: '下面是几条已经写好的【周报示例】：\n',
  suffix: '\n基于上面的示例风格，请帮我写一份新的周报。',
  inputVariables: [],
});
```

指定模板和填入的值就可以了，生成的就是这种带少量示例（Few Shot）的 prompt。

### 2.4 ExampleSelector

而且还可以根据**长度、语义**来做示例选择：

```js
// 按长度自动截断
import { LengthBasedExampleSelector } from '@langchain/core/example_selectors';

const selector = new LengthBasedExampleSelector({
  examples,
  examplePrompt,
  maxLength: 200, // token 上限，优先选短的
});
```

```js
// 按语义相似度检索 — 用 Milvus + embedding 检索最相关的示例
import { SemanticSimilarityExampleSelector } from '@langchain/core/example_selectors';

const selector = new SemanticSimilarityExampleSelector({
  vectorStore,  // Milvus / 其他向量数据库
  k: 2,         // 返回最相似的 2 条
  inputKeys: ['input'],
});
```

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`prompt-template-test/src/chat-prompt-template.mjs`](prompt-template-test/src/chat-prompt-template.mjs) | ChatPromptTemplate 多角色消息 |
> | [`prompt-template-test/src/pipeline-prompt-template.mjs`](prompt-template-test/src/pipeline-prompt-template.mjs) | PipelinePromptTemplate 模块化组合 |
> | [`prompt-template-test/src/pipeline-prompt-template2.mjs`](prompt-template-test/src/pipeline-prompt-template2.mjs) | Pipeline 复用篇 |
> | [`prompt-template-test/src/pipeline-prompt-template3.mjs`](prompt-template-test/src/pipeline-prompt-template3.mjs) | Pipeline 聊天格式篇 |
> | [`prompt-template-test/src/fewshot-prompt-template.mjs`](prompt-template-test/src/fewshot-prompt-template.mjs) | FewShotPromptTemplate |
> | [`prompt-template-test/src/fewshot-chat-prompt-template.mjs`](prompt-template-test/src/fewshot-chat-prompt-template.mjs) | FewShotChatMessagePromptTemplate |
> | [`prompt-template-test/src/example-selector1.mjs`](prompt-template-test/src/example-selector1.mjs) | LengthBasedExampleSelector |
> | [`prompt-template-test/src/example-selector2.mjs`](prompt-template-test/src/example-selector2.mjs) | SemanticSimilarityExampleSelector |
> | [`prompt-template-test/src/messages-placeholder.mjs`](prompt-template-test/src/messages-placeholder.mjs) | MessagesPlaceholder 动态注入 |
> | [`prompt-template-test/src/partial.mjs`](prompt-template-test/src/partial.mjs) | .partial() 预填变量 |

---

## 三、OutputParser — 输出控制

然后是输出部分，也就是 OutputParser。

我们希望大模型按照我们指定的格式输出，比如某个 JSON 结构。这依赖两种机制：

1. **tool_call** — 通过 tool 声明格式，模型强制按 Schema 输出
2. **json_schema** — 通过 `response_format` 约束模型输出 JSON

大模型训练的时候就强制 tool_call、json_schema 只能输出符合格式的 JSON，所以能保证返回的一定是符合格式要求的。

### 3.1 model.withStructuredOutput()

**不用自己区分用哪种方式**，直接调用 `model.withStructuredOutput()` 就可以了，LangChain 会根据调用的模型来选择用哪种（优先 tool call）：

```js
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

const model = new ChatOpenAI({
  modelName: 'gpt-4o',
  temperature: 0,
});

// 用 Zod 定义 Schema
const scientistSchema = z.object({
  name: z.string().describe('科学家的全名'),
  birth_year: z.number().describe('出生年份'),
  nationality: z.string().describe('国籍'),
  fields: z.array(z.string()).describe('研究领域列表'),
});

// 一行搞定结构化输出 — LangChain 自动选择 tool_call 或 json_schema
const structuredModel = model.withStructuredOutput(scientistSchema);
const result = await structuredModel.invoke('介绍一下爱因斯坦');

console.log(result);
// => { name: '阿尔伯特·爱因斯坦', birth_year: 1879, ... }
```

我们做了一个智能录入数据的例子：AI 应用里这个功能很常见。

### 3.2 OutputParser 详解

一般用 `model.withStructuredOutput` 就可以了，但在一些场景下，还是需要 OutputParser 的：

- **流式打印** — 需要增量解析
- **非 JSON 格式** — 如 XML

比如我们做的流式版 mini cursor，就是用的 `JsonOutputToolsParser` 解析了流式的内容：

```js
import { JsonOutputToolsParser } from '@langchain/core/output_parsers/openai_tools';

const model = new ChatOpenAI({ temperature: 0 });

const modelWithTool = model.bindTools([
  {
    name: 'extract_scientist_info',
    description: '提取和结构化科学家的详细信息',
    schema: z.object({
      name: z.string().describe('科学家的全名'),
      birth_year: z.number().describe('出生年份'),
      nationality: z.string().describe('国籍'),
      fields: z.array(z.string()).describe('研究领域列表'),
    }),
  },
]);

// 管道：绑定工具 → 流式解析
const parser = new JsonOutputToolsParser();
const chain = modelWithTool.pipe(parser);

const stream = await chain.stream('详细介绍牛顿的生平和成就');

// 流式增量输出
for await (const chunk of stream) {
  if (chunk.length > 0) {
    const toolCall = chunk[0];
    // args 是当前累积的完整快照，做增量对比输出
    console.log(toolCall.args);
  }
}
```

之前流式返回的内容参数片段在 `tool_call_chunks` 里。用了 `JsonOutputToolsParser` 后会解析成 JSON 格式。这时候的片段信息不完整，比如少了大括号、少了一半引号等。如果自己解析 JSON 还是挺麻烦的，就可以直接用这个 OutputParser。

### 3.3 各种 OutputParser

类似这种 OutputParser 我们也学了一些：

| Parser | 用途 |
|--------|------|
| `StringOutputParser` | 从各种格式里取出内容，返回字符串 |
| `StructuredOutputParser` | 按照某种 JSON 格式返回内容并解析成对象 |
| `XMLOutputParser` | 按照 XML 格式返回内容并解析成对象 |
| `JsonOutputToolsParser` | 解析 tool_call 的信息，支持流式 |

在大模型的输出控制方面，`model.withStructuredOutput` 加上 OutputParser 就够用了。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`output-parser-test/src/with-structured-output.mjs`](output-parser-test/src/with-structured-output.mjs) | withStructuredOutput 非流式 |
> | [`output-parser-test/src/stream-with-structured-output.mjs`](output-parser-test/src/stream-with-structured-output.mjs) | withStructuredOutput 流式 |
> | [`output-parser-test/src/stream-tool-calls-parser.mjs`](output-parser-test/src/stream-tool-calls-parser.mjs) | JsonOutputToolsParser 流式解析 |
> | [`output-parser-test/src/stream-tool-calls-raw.mjs`](output-parser-test/src/stream-tool-calls-raw.mjs) | 原始 tool_call_chunks 方式 |
> | [`output-parser-test/src/tool-calls-args.mjs`](output-parser-test/src/tool-calls-args.mjs) | bindTools + args 非流式 |
> | [`output-parser-test/src/json-output-parser.mjs`](output-parser-test/src/json-output-parser.mjs) | JsonOutputParser |
> | [`output-parser-test/src/xml-output-parser.mjs`](output-parser-test/src/xml-output-parser.mjs) | XMLOutputParser |
> | [`output-parser-test/src/structured-output-parser.mjs`](output-parser-test/src/structured-output-parser.mjs) | fromNamesAndDescriptions |
> | [`output-parser-test/src/structured-output-parser2.mjs`](output-parser-test/src/structured-output-parser2.mjs) | fromZodSchema 嵌套结构 |
> | [`output-parser-test/src/structured-json-schema.mjs`](output-parser-test/src/structured-json-schema.mjs) | 原生 JSON Schema |
> | [`output-parser-test/src/test/smart-import.mjs`](output-parser-test/src/test/smart-import.mjs) | 实战：AI 数据录入 |
> | [`output-parser-test/src/test/mini-cursor.mjs`](output-parser-test/src/test/mini-cursor.mjs) | 实战：流式 mini cursor |

---

## 四、Tool & MCP

输出格式控制用到了 tool_call，这是我们最先学的特性。

### 4.1 bindTools

定义 tool，加一下 name、description、参数 schema，然后 `model.bindTools()` 绑定到大模型：

```js
import { z } from 'zod';

// 定义 tool 的 Schema
const modelWithTool = model.bindTools([
  {
    name: 'extract_scientist_info',
    description: '提取和结构化科学家的详细信息',
    schema: z.object({
      name: z.string().describe('科学家的全名'),
      birth_year: z.number().describe('出生年份'),
      nationality: z.string().describe('国籍'),
      fields: z.array(z.string()).describe('研究领域列表'),
    }),
  },
]);

const response = await modelWithTool.invoke('介绍一下爱因斯坦');
// 直接从 args 获取结构化结果
const result = response.tool_calls[0].args;
```

只要描述写得清楚，那大模型就会在需要调用 tool 的时候返回 `tool_calls` 信息，并且按照你指定的 schema 来填充参数。

### 4.2 Tool 定义 + 循环调用

也可以定义带函数体的 tool，然后 Agent 循环调用：

```js
import { tool } from '@langchain/core/tools';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';

// 定义可执行的工具
const readFileTool = tool(
  async ({ filePath }) => {
    const content = await fs.readFile(filePath, 'utf-8');
    return `文件内容:\n${content}`;
  },
  {
    name: 'read_file',
    description: '读取指定路径的文件内容',
    schema: z.object({
      filePath: z.string().describe('文件路径'),
    }),
  }
);

// Agent 循环
let messages = [new HumanMessage(query)];
for (let i = 0; i < maxIterations; i++) {
  const response = await modelWithTools.invoke(messages);
  messages.push(response);

  // 没有 tool_call → 最终答案
  if (!response.tool_calls?.length) {
    return response.content;
  }

  // 有 tool_call → 执行工具，结果封成 ToolMessage 放入 messages
  for (const toolCall of response.tool_calls) {
    const foundTool = tools.find(t => t.name === toolCall.name);
    const result = await foundTool.invoke(toolCall.args);
    messages.push(new ToolMessage({
      content: result,
      tool_call_id: toolCall.id,
    }));
  }
}
```

直到没有新的 `tool_call`，循环结束。

### 4.3 MCP

当然，不是所有的 tool 都要自己写，有很多 MCP（可跨进程调用的 tool）可以直接复用。

如果 MCP Server 跑在本地进程，就是用 stdio 进程通信，否则就是 HTTP 通信。

比如高德 MCP 用了 HTTP 通信，而 Chrome Devtools 的 MCP 用了 stdio 本地进程通信。

代码里是用 `@langchain/mcp-adapters` 这个包来和 MCP Server 通信：

```js
import { MultiServerMCPClient } from '@langchain/mcp-adapters';

// 连接本地 MCP Server
const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    'my-mcp-server': {
      command: 'node',
      args: ['path/to/mcp-server.mjs'],
    },
  },
});

// client.getTools() 拿到所有 tool
const tools = await mcpClient.getTools();
const modelWithTools = model.bindTools(tools);

// 之后的使用和自定义 tool 完全一样
```

`client.getTools()` 拿到所有 tool，然后绑定到大模型就好了，其余的跟自定义 tool 没区别。依然是那个循环。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`tool-test/src/all-tools.mjs`](tool-test/src/all-tools.mjs) | 自定义 4 个 LangChain tool |
> | [`tool-test/src/langchain-mcp-test.mjs`](tool-test/src/langchain-mcp-test.mjs) | LangChain 集成 MCP |
> | [`tool-test/src/mcp-test.mjs`](tool-test/src/mcp-test.mjs) | 多服务器 MCP 集成 |
> | [`tool-test/src/my-mcp-server.mjs`](tool-test/src/my-mcp-server.mjs) | MCP Server 实现 |
> | [`tool-test/src/mini-cursor.mjs`](tool-test/src/mini-cursor.mjs) | Agent 调用工具集 |
> | [`tool-test/src/tool-file-read.mjs`](tool-test/src/tool-file-read.mjs) | 文件读取工具入门 |
> | [`output-parser-test/src/tool-calls-args.mjs`](output-parser-test/src/tool-calls-args.mjs) | bindTools + 直接从 args 取结果 |

---

## 五、Memory — 记忆管理

这个循环如果调用次数少，没啥问题——把所有对话放到 messages 数组。但是如果聊得多了，这样可能会超过大模型上下文限制，就需要做一些 memory 的处理。

比如你用 Cursor、Claude Code 的时候，token 到了上限就会触发总结。

### ChatMessageHistory

messages 数组的写法太原始，一般用 `ChatMessageHistory` 的 API：

```js
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

const history = new InMemoryChatMessageHistory();
const systemMessage = new SystemMessage('你是一个友好、幽默的做菜助手。');

// 第一轮
const userMsg1 = new HumanMessage('你今天吃的什么？');
await history.addMessage(userMsg1);
const messages1 = [systemMessage, ...(await history.getMessages())];
const response1 = await model.invoke(messages1);
await history.addMessage(response1);

// 第二轮 — "好吃吗？" 能关联到上一轮
const userMsg2 = new HumanMessage('好吃吗？');
await history.addMessage(userMsg2);
const messages2 = [systemMessage, ...(await history.getMessages())];
const response2 = await model.invoke(messages2);
await history.addMessage(response2);
```

它可以把 messages 存到内存、redis、文件、数据库等。

### Memory 的三种管理策略

1. **截断** — 去掉之前的旧 message，保留最近的
2. **总结** — 调用大模型对之前的 messages 生成摘要
3. **检索** — 基于向量数据库，根据 query 检索之前聊的内容来继续聊

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`memory-test/src/history-test.mjs`](memory-test/src/history-test.mjs) | InMemoryChatMessageHistory 内存存储 |
> | [`memory-test/src/history-test2.mjs`](memory-test/src/history-test2.mjs) | FileSystemChatMessageHistory 文件存储 |
> | [`memory-test/src/history-test3.mjs`](memory-test/src/history-test3.mjs) | RunnableWithMessageHistory + memory 策略 |
> | [`memory-test/src/memory/`](memory-test/src/memory/) | Memory 管理策略实现 |

---

## 六、RAG — 检索增强生成

长时记忆基本都是要用向量数据库检索的。检索涉及到 RAG，这基本也是 Agent 必备的功能。

### 6.1 向量化和余弦相似度

把一段内容向量化，在坐标空间内就可以通过夹角来判断相似度，也就是**余弦相似度**。

当然实际上向量的维度很大，比如 1024。

### 6.2 RAG 流程

基于 Milvus 之类的向量数据库，可以快速根据向量的余弦相似度，检索出相关文档。

RAG 的流程是这样的：

**① 存入：** 各种来源的内容 → Loader 加载 → Splitter 分割 → 嵌入模型向量化 → 存入 Milvus

**② 检索：** Query → 向量化 → 余弦相似度匹配 → 检索出相关文档

**③ 生成：** 上下文 + Query → 大模型生成回答

```js
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';

// 1. 嵌入模型
const embeddings = new OpenAIEmbeddings({
  model: 'text-embedding-3-small',
});

// 2. 准备文档
const documents = [
  new Document({
    pageContent: '光光是一个活泼开朗的小男孩…',
    metadata: { chapter: 1, character: '光光' },
  }),
  // ... 更多文档
];

// 3. 向量化存入向量数据库
const vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings);

// 4. 检索
const retriever = vectorStore.asRetriever({ k: 3 });
const retrievedDocs = await retriever.invoke('东东和光光是怎么成为朋友的？');

// 5. 构建增强 Prompt
const context = retrievedDocs.map((doc, i) => `[片段${i + 1}]\n${doc.pageContent}`).join('\n');
const prompt = `基于以下故事片段回答问题:\n${context}\n\n问题: ${question}`;

// 6. LLM 生成回答
const response = await model.invoke(prompt);
```

比如我们做的**电子书阅读助手**，就是检索了 5 个片段，然后给大模型基于这些语义相关的片段来生成回答。这就是 RAG 的流程。

### 6.3 Milvus 原生包 vs LangChain 封装

我们是直接用的 `@zilliz/milvus2-sdk-node` 这个 Milvus 的包。

实际上 LangChain 有一层封装，在 `@langchain/community` 包下：

```js
import { Milvus } from '@langchain/community/vectorstores/milvus';
```

用这层封装是更好的，就像前面讲 ChatModel 一样，它也是屏蔽了底层差异。调用 `similaritySearchVectorWithScore` 做相似度检索。

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`rag-test/src/hello-rag.mjs`](rag-test/src/hello-rag.mjs) | RAG 入门：MemoryVectorStore 完整流程 |
> | [`rag-test/src/loader-and-splitter.mjs`](rag-test/src/loader-and-splitter.mjs) | Loader + Splitter 文档预处理 |
> | [`rag-test/src/loader-and-splitter2.mjs`](rag-test/src/loader-and-splitter2.mjs) | 真实网页 + 完整 RAG 链路 |
> | [`milvus-test/`](milvus-test/) | Milvus 向量数据库实战 |

---

## 七、LCEL — LangChain 表达式语言

至此，我们 LangChain 的各个组件就都过了一遍：

> ChatModel、PromptTemplate、OutputParser、Tool、MCP、Memory、RAG

但如果硬编码的方式组合这些组件不好管理，每个人写法都不一样。而且如果你想加一下监测某个组件输入输出、执行耗时、token 消耗等逻辑，也得硬编码。

所以 LangChain 提供了一种声明式的编码方式：**LCEL（LangChain Expression Language）**。

### 7.1 Runnable 接口

每个组件都实现了 `Runnable` 接口，比如 ChatModel、OutputParser、PromptTemplate 等。

提供了一系列 Runnable 的 API 可以**连接不同的组件**，这样组装出一条 chain 之后，统一执行。

调用方式有三种：

| 方式 | 说明 |
|------|------|
| `invoke()` | 同步调用 |
| `stream()` | 流式调用 |
| `batch()` | 批量调用 |

**没有 LCEL 的手动写法：**

```js
// 手动三步调用 — 每步需显式传参并 await
const formattedPrompt = await promptTemplate.format(input);
const response = await model.invoke(formattedPrompt);
const result = await outputParser.invoke(response);
```

**有 LCEL 的写法：**

```js
import { RunnableSequence } from '@langchain/core/runnables';

// 声明式链式组合 — 一行 invoke 搞定
const chain = RunnableSequence.from([
  promptTemplate,   // 1. 格式化 prompt
  model,            // 2. 调用 LLM
  outputParser,     // 3. 解析输出
]);

// 等效的 .pipe() 写法
// const chain = promptTemplate.pipe(model).pipe(outputParser);

const result = await chain.invoke(input);
```

### 7.2 callbacks — 动态注入逻辑

再回到刚才那个问题，有了声明式的 chain 之后，再加耗时、token 消耗、输入输出的日志等，怎么做呢？

只要加一个 `callbacks` 回调就可以了，所有的节点就动态加上了这段逻辑。这就是**声明式写法的好处**。

后面我们会学 LangSmith，它是用来做 chain 执行的监测的，它是怎么监测每个节点的情况的呢？就是基于 Runnable 的 callbacks。

也就是说，通过 LCEL 的写法，把各个组件用声明式的方式连接起来，可以动态加一些逻辑。而且每个节点自带了重试、备选方案、配置等功能，开箱即用。

### 7.3 Runnable API 一览

当然，这种写法要学一些 API：

| API | 用途 |
|-----|------|
| `RunnableSequence` | 顺序执行 A → B → C |
| `RunnableLambda` | 把函数包装成 Runnable |
| `RunnableMap` | 并行执行多个 chain，结果放在对象属性上 |
| `RunnableBranch` | if-else 逻辑分支 |
| `RunnableEach` | 循环数组每个元素调用 chain |
| `RunnablePassthrough` | 拿到原始输入 |
| `RunnablePick` | 取输入对象的某些属性返回 |
| `RunnableWithMessageHistory` | 给 chain 加上 Memory |

（写法上可以简化，函数会自动转成 `RunnableLambda`、对象会自动转成 `RunnableMap`）

### 7.4 三步法

基本都是这三步：

1. **分析流程，拆分原子步骤**
2. **根据步骤之间的关系，选择对应 Runnable API**
3. **统一调用**（`invoke` / `stream` / `batch`）

总之，有了 LCEL 后，LangChain 就不再只是工具集，而是一个**工业化流水线**。每个节点都自带一些功能，还可以给每个节点动态加一些逻辑。

这些就是 LangChain 的全部功能了：

- **各个组件**
- **LCEL 连接组件成为 chain**

> 📂 **对应源码**
>
> | 文件 | 说明 |
> |------|------|
> | [`runnable-test/src/before.mjs`](runnable-test/src/before.mjs) | 对照版：没有 Runnable 的手动调用 |
> | [`runnable-test/src/runnable.mjs`](runnable-test/src/runnable.mjs) | RunnableSequence 入门 |
> | [`runnable-test/src/runnables/`](runnable-test/src/runnables/) | 12 个 Runnable API 实战 |
> | [`runnable-test/src/cases/`](runnable-test/src/cases/) | 综合案例 |

---

## 八、总结

LangChain 通过 ChatModel 屏蔽了各种大模型的差异，可以用同样的 API 来写代码，可以切换大模型。

我们过了一遍各种组件：

- **ChatModel** — 统一大模型调用
- **PromptTemplate** — 组件化管理 prompt，Few Shot 示例
- **OutputParser** — 结构化输出控制，流式解析
- **Tool & MCP** — 工具定义与 Agent 循环，MCP 复用
- **Memory** — 对话历史管理，截断/总结/检索三种策略
- **RAG** — 向量化检索增强生成

然后是 **LCEL** 组合各种组件，编排 chain，它可以给节点动态增删逻辑，而且还内置了一些功能。

学完组件可以说 LangChain 是**工具集**，学完 LCEL 就可以说 LangChain 是**工业流水线**了。

把这两方面都掌握好，LangChain 就学得差不多了。
