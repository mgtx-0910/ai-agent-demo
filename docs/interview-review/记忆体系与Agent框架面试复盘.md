# 记忆体系与 Agent 框架面试复盘

> 整理范围：LangChain/LangGraph 区别、LangGraph 四大概念、Tool Calling 链路、`knowledge-hub-backend` 记忆体系、短期/长期记忆划分、私有化部署与微调、0.7B 显存计算，附两轮追问（消息表 vs 长期记忆、Mem0 原理与自托管）。
>
> 涉及项目：`knowledge-hub-backend`、`mem0-test`

---

## 目录

1. [LangChain 与 LangGraph 的区别](#1-langchain-与-langgraph-的区别)
2. [LangGraph：State / Node / 条件边 / Checkpoint](#2-langgraphstate--node--条件边--checkpoint)
3. [Tool Calling 全链路](#3-tool-calling-全链路)
4. [项目记忆体系（knowledge-hub-backend）](#4-项目记忆体系knowledge-hub-backend)
5. [短期记忆与长期记忆的区分](#5-短期记忆与长期记忆的区分)
6. [私有化部署与微调](#6-私有化部署与微调)
7. [0.7B 模型的显存计算与显卡选型](#7-07b-模型的显存计算与显卡选型)
8. [附录 A：有会话表与消息表，为什么还需要长期记忆](#附录-a有会话表与消息表为什么还需要长期记忆)
9. [附录 B：Mem0 的原理与免费自托管](#附录-bmem0-的原理与免费自托管)
10. [附录 C：已知短板与自测清单](#附录-c已知短板与自测清单)

---

## 1. LangChain 与 LangGraph 的区别

一句话：**LangChain 是"组件与抽象层"，LangGraph 是"状态编排运行时"。**

| 维度 | LangChain | LangGraph |
|---|---|---|
| 解决的问题 | 单次或线性多次调用的**拼装**：Model / Prompt / Parser / Tool / Retriever / Runnable(LCEL) | 多步、循环、有状态的**流程编排** |
| 控制流 | DAG 式管道，一次性数据流 | 图 + 显式循环、条件分支、并行、子图 |
| 状态 | 无共享状态，数据沿管道传递 | 显式共享 State，Node 返回增量由 reducer 合并 |
| 持久化 | 无 | Checkpointer（断点续跑、时间旅行、interrupt） |
| 执行模型 | 链式调用 | Pregel / BSP superstep，同层节点并行 |
| 适合场景 | 简单 RAG、单轮问答、结构化抽取 | Agent、多工具循环、多 Agent、长任务可恢复 |

**关键趋势**：LangChain v1 的 `createAgent` 本质是"LangGraph 之上的一层封装"，即一张 ReAct 图。两者不是二选一：

> LangChain 是上层 API（模型、工具、消息的抽象），LangGraph 是下层运行时（状态、循环、持久化）。

**本项目体现**：`knowledge-hub-backend/package.json` 只依赖 `langchain` + `@langchain/core`，`src` 内 0 处引用 `@langchain/langgraph`，但底层跑的是 LangGraph 的 ReAct 图（`src/ai/ai-stream.service.ts:363`）。

---

## 2. LangGraph：State / Node / 条件边 / Checkpoint

### 2.1 State：多个 channel + 各自的 reducer

JS 版用 `Annotation`（底层 Zod）。每个字段有独立 reducer，Node 只返回增量：

```ts
const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (a, b) => a.concat(b),  // 追加式，不要就地 push
    default: () => [],
  }),
  intent: Annotation<string>(),      // 默认 last-write-wins
});
```

- **为什么必须返回增量**：节点可能并行执行，就地修改会产生竞争。
- Python 版对应 `TypedDict` + `Annotated[list, add_messages]`。
- `addMessages` 会按 message id 去重/替换，而非无脑 concat。

### 2.2 Node

纯函数 `async (state) => Partial<State>`：读 state，返回部分更新。可以是 LLM 调用、工具执行、DB 查询，也可以嵌套子图。Node 不决定"下一步去哪"，那是边的职责。

### 2.3 条件边

```ts
graph.addConditionalEdges('agent', (state) => {
  const last = state.messages.at(-1);
  return last?.tool_calls?.length ? 'tools' : END;
}, { tools: 'tools', [END]: END });
```

- router 必须是**纯函数**（可预测、可重放），不能有副作用。
- 返回 `END` 表示终止。ReAct 的"要不要调工具"就靠这条边；循环上限另设 `recursionLimit` 或中间件（本项目用 `modelCallLimitMiddleware({ runLimit: 8 })`）。

### 2.4 Checkpoint

每个 superstep 结束后对整个 state 做快照，按 `thread_id + checkpoint_id` 索引，存于 `MemorySaver` / `PostgresSaver` / `RedisSaver`。

四个能力：

1. **断点恢复**：进程重启后带同一 `thread_id` 进来接着跑，已完成节点不重跑。
2. **跨轮对话的短期记忆**：同一 `thread_id` 自动接上前文，无需手工传 `history`。
3. **时间旅行**：`getStateHistory()` 列快照、`updateState()` 从某快照分叉重跑。
4. **人工介入**：`interrupt()` 暂停等审批，`Command(resume=...)` 继续，LangChain 做不到。

**易混点**：checkpoint 存的是"执行态"，不等于业务含义的"长期记忆"。

---

## 3. Tool Calling 全链路

Tool Calling 不是模型"调函数"，而是**模型输出结构化意图 + 你的代码执行 + 结果回灌**的闭环。

```
用户问题
 → 请求里带 tools=[{name, description, parameters: JSON Schema}]
 → 模型返回 tool_calls: [{id, name, arguments:"{\"q\":\"...\"}"}]   ← 纯文本 JSON，未执行
 → 应用侧解析：按 name 找本地实现 → Zod/JSON Schema 校验入参
 → 执行（并发/超时/鉴权/异常兜底）
 → 结果包成 ToolMessage(content, tool_call_id) 追加进 messages
 → 再次请求模型（此时模型才看到工具结果）
 → 循环直到模型返回普通文本 或 达到最大轮数
```

### 必须注意的 7 个点

1. **`tool_call_id` 必须配对**。并行 tool_calls 结果乱序无妨，靠 id 对齐；漏一个直接 400。
2. **参数校验前置**。校验失败要转成"错误提示"回灌让模型自纠，而不是抛异常终止。
3. **工具执行失败要降级成文本**。`return "检索服务超时，请换个说法"`，让模型有机会换策略；抛异常会断掉整个图。
4. **结果要截断**。RAG 召回 10 段原文塞回去直接爆 token。
5. **工具描述决定选对率**。写清"何时该调、何时不该调、入参语义"。
6. **循环上限**。必须有 runLimit，否则可能无限调同一工具。
7. **安全**。工具是唯一执行面：参数白名单、SQL 拼接防护、越权校验、幂等键、超时。

### 流式链路

先流 `tool_call_chunks` 拼出完整 arguments（前端显示"正在检索…"），执行工具，再流最终文本。本项目用 `streamMode: ['messages','tools']` 推事件（`src/ai/ai-stream.service.ts:552-559`），工具为 `retrieve_knowledge / rewrite_query / retrieve_graph / web_search`。

### 进阶

工具也可以做成独立 Node 而非塞在 agent 内部，好处是能插条件边（如"检索置信度低 → 改写 query 重试"）。本项目 `rewrite_query` 作为工具暴露，属"模型自主决定"，更稳的做法是做成条件分支。

---

## 4. 项目记忆体系（knowledge-hub-backend）

**架构：三层，Postgres 权威 → Redis 热窗口 → Mem0 长期，逐层降级。**

```
写：问答完成 → 消息落 PG(ai_message) → 更新 Redis 窗口 → 异步 rememberTurn → Mem0
读：Redis 命中即用 → 未命中回查 PG 最近 N 条 → 回写 Redis
```

### 4.1 短期记忆：Redis 热窗口 + PG 回填

```ts
// src/ai/chat-short-memory.service.ts:29-36
this.ttlSeconds  = Number(config.get('CHAT_SHORT_MEMORY_TTL_SECONDS', 86400));
this.maxMessages = Number(config.get('CHAT_SHORT_MEMORY_MAX_MESSAGES', 20));
this.keyPrefix   = config.get('CHAT_SHORT_MEMORY_KEY_PREFIX', 'kh:chat');
```

- 隔离键是 **`userId + sessionId`**：`kh:chat:{userId}:{sessionId}:messages`（`:98-100`）。
- 裁剪是**滑动窗口 `slice(-20)`**，且**只存 human/ai 原文**，过滤 `SystemMessage` 与检索资料（`:63-66`），避免 RAG 原文当历史越滚越大。
- 回填在 `ai-stream.service.ts:627-643`（`loadWorkingHistory`）：Redis miss → `listRecentMessages`（DESC 取 N 再 reverse）→ 写回 Redis。非流式侧见 `ai-chat.service.ts:327-344`。
- 会话内二次压缩用 `summarizationMiddleware`（`ai-stream.service.ts:367-376`）：`trigger: {messages:12}`、`keep: {messages:6}`。**摘要只活在单次请求内存里，不回写 Redis/PG**，跨轮压缩完全靠 Redis 的 20 条窗口。

### 4.2 长期记忆：Mem0 双层作用域 + LLM 分类器

```ts
// src/ai/chat-long-memory.service.ts:8-20
const memorySchema = z.object({
  write_user:    z.boolean().describe('写入用户层：换会话仍应保留的身份、偏好、长期约束'),
  write_session: z.boolean().describe('写入会话层：仅当前会话的任务、进度、待办'),
  reason:        z.string(),
});
```

- 用**结构化输出的 LLM 当分类器**决定"值不值得记 / 记哪一层"，比关键词规则稳。
- `extractFrom` 只传 user 消息（`:170`），`customInstructions` 禁止把知识库条文写成 user 记忆，**防止文档事实污染用户画像**——整套设计最讲究的一点。
- 检索**双 scope、各 topK=5**：user 层 `{user_id}`，session 层 `{AND:[{user_id},{run_id}]}`（`:117-128`）。
- 去重/冲突合并交给 Mem0 内部（embedding 相似 + LLM UPDATE）；项目只做级联删除 `deleteAll`（`:209-218`）。
- 无 `MEM0_API_KEY` 时 `client` 为 `undefined`，整条链路静默跳过（`:68-75`）。

### 4.3 记忆与 RAG 的合流

```ts
// src/ai/ai-chat.service.ts:271-286
new SystemMessage(this.buildSystemPrompt(...)),     // 角色
...(memoryMsg ? [memoryMsg] : []),                  // 用户背景（Mem0）
...(graphMsg ? [new SystemMessage(graphMsg)] : []), // 图谱事实
...history,                                          // 有序对话窗口
new HumanMessage(知识库资料 + 联网结果 + 用户问题)
```

**优先级硬约束**写在两处 prompt：`chat-long-memory.service.ts:158-160` 与 `ai-chat.service.ts:399-401`。

> 记忆只能影响"怎么答"，不能覆盖"答什么"——防幻觉核心。

记忆召回的 query 用**改写后的 `plan.query`**（`ai-chat.service.ts:146-149`），与 KB 检索共用同一个消解了指代的 query。

### 4.4 刻意不用 LangGraph 持久化

全项目 `thread_id / MemorySaver / PostgresSaver / getStateHistory` **0 命中**。`createAgent` 每轮重建，历史手工注入（`ai-stream.service.ts:544-565`）。

> **取舍**：放弃 time-travel / checkpoint 回滚，换取存储透明、可控、跨会话可审计（历史走 DB 分页，`sources` 以 JSONB 落库）。代价是每次新建图、无法从中间某步重试。

### 4.5 关键文件

| 文件 | 职责 |
|---|---|
| `src/ai/chat-short-memory.service.ts` | Redis 热窗口读写 |
| `src/ai/chat-long-memory.service.ts` | Mem0 长期记忆 + 分类器 |
| `src/ai/chat-memory.util.ts` | 消息序列化/过滤 |
| `src/ai/chat-session.service.ts` | 会话与消息表、级联清理 |
| `src/ai/ai-stream.service.ts` | 流式问答、agent 装配、窗口回填 |
| `src/ai/ai-chat.service.ts` | 非流式问答、prompt 拼装 |

---

## 5. 短期记忆与长期记忆的区分

| 维度 | 短期记忆 | 长期记忆 |
|---|---|---|
| 生命周期 | 单次会话，随 TTL 或窗口过期 | 跨会话永久沉淀 |
| 载体 | 上下文窗口 messages / Redis 热窗口 / 图 state / checkpointer | 画像表、向量库、Mem0、知识图谱 |
| 内容形态 | **原始对话原文**，含指代、噪声 | **独立成立的结构化事实** |
| 写入方式 | 直接追加 | LLM 抽取 → 去重/合并/更新/遗忘 |
| 读取方式 | 按时间序全量注入 | 相似度或 key 检索，topK 注入 system |
| 容量压力 | 受 context window 硬限制 | 受检索精度限制，不在长度 |
| 失效策略 | 条数窗口、TTL、摘要压缩 | 置信度衰减、TTL、用户删除、冲突覆盖 |
| 核心目标 | **指代连贯**、保持任务进度 | **个性化与画像沉淀** |

**判断标准一句话**：这段内容**脱离原始对话是否仍能独立成立**？能，就是长期记忆候选；不能（"就按刚才那个来"），只能留在短期。

### 三个常见误区

1. **"上下文长就是长期记忆"**——那只是窗口更大，关掉会话什么都没留下。
2. **"把历史全塞向量库就是长期记忆"**——只是把原文搬了位置，召回仍是碎片而非事实。
3. **"摘要就是长期记忆"**——摘要是短期记忆的**压缩**（有损、仍属会话内），长期记忆需要**抽取与改写**。

### 认知科学分类（CoALA）可补充

- **Episodic**：发生过什么
- **Semantic**：关于用户和世界的事实
- **Procedural**：怎么做事（system prompt、工具使用习惯）

本项目：Mem0 user 层覆盖 Semantic，session 层覆盖 Episodic，Procedural 固化在 prompt 与工具里。

---

## 6. 私有化部署与微调

> 定位表述：原理和流程较熟，有本地与小规模部署实操，但没有大规模 GPU 集群推理调优经验。

### 6.1 推理部署选型

| 方案 | 特点 | 适用 |
|---|---|---|
| vLLM | PagedAttention、continuous batching、prefix caching、TP/PP 并行 | 生产首选，OpenAI 兼容协议 |
| SGLang | RadixAttention，前缀复用更强 | 多轮 / 共享 system prompt 更省 |
| Ollama / llama.cpp | GGUF 量化、CPU/Mac 可跑、零运维 | 本地开发、边缘、POC |
| TGI / TensorRT-LLM / LMDeploy | 极致性能或特定硬件 | 深度优化场景 |

量化是核心杠杆：**AWQ/GPTQ（4bit 权重）、FP8、GGUF Q4_K_M、KV Cache 量化**。4bit 权重量化省 60%+ 显存，3B 以上质量损失通常可忽略，但**长上下文推理退化更明显**，必须自测。

### 6.2 微调

- **全参 SFT**：多卡 FSDP / DeepSpeed ZeRO-3，7B 约需 8×80G；成本高、易灾难性遗忘。
- **LoRA / QLoRA**：`r=8~64`、`alpha=2r`、`target_modules` 覆盖所有 linear 层、4bit nf4 + bf16 计算。**7B 单卡 24G 可跑 QLoRA**。
- **对齐**：DPO / ORPO / GRPO 替代 RLHF，数据量需求小得多。
- **继续预训练**：领域自适应，成本最高，通常 SFT 不够时才考虑。
- **蒸馏**：大模型造数据训小模型，做任务专用小模型最常见。

### 6.3 什么时候不该微调（比会微调更重要）

1. **知识注入 → 用 RAG**。微调记知识会幻觉且无法溯源、无法更新。
2. **输出格式/风格 → prompt + few-shot + 结构化输出**（本项目 zod 结构化输出即此类）。
3. **只有这三类值得 SFT**：稳定的领域输出风格、高频固定任务降本、私有数据的行为模式（不是知识）。

### 6.4 工程链路

数据构造（去重 / 防评测集污染）→ 训练 → 合并权重或 adapter 服务化 → **通用能力回退评测**（MMLU / IFEval / 自建集，最容易漏）→ 离线 A/B → 灰度。

---

## 7. 0.7B 模型的显存计算与显卡选型

显存 = **权重 + KV Cache + 激活峰值 + 框架开销**。KV Cache 决定并发能力，是真实瓶颈。

### 7.1 权重

```
权重显存 = 参数量 × 每参数字节数
0.7B × 2B (FP16/BF16) = 1.4 GB
0.7B × 4B (FP32)      = 2.8 GB
0.7B × 1B (INT8)      = 0.7 GB
0.7B × 0.5B (INT4)    = 0.35 GB
```

### 7.2 KV Cache（真正的变量）

```
KV = 2 × n_layers × n_kv_heads × head_dim × seq_len × batch × bytes_per_elem
```

以典型 0.7B（24 层、`n_kv_heads=8` GQA、`head_dim=64`、FP16）为例：

```
单 token KV = 2 × 24 × 8 × 64 × 2B = 49,152 B ≈ 48 KB
4096 上下文 ≈ 0.19 GB / 请求
32 并发 × 4096 ≈ 6.0 GB      ← 已超过权重本身
```

Qwen3-0.6B 这类（28 层、`n_kv_heads=8`、`head_dim=128`）约 **112 KB/token**，4096 上下文约 0.44 GB/请求，32 并发 ≈ 14 GB。

> **必须查模型 `config.json` 的 `num_key_value_heads`，不要凭参数量猜。**

### 7.3 激活 + 框架开销

- 推理激活峰值：小模型 prefill 通常 0.5~1.5 GB
- CUDA context + workspace + 显存碎片：预留 **1.5~2 GB**
- vLLM 另有 `gpu_memory_utilization`（默认 0.9）作为总闸

### 7.4 总账与选型

| 场景 | 显存需求 | 显卡 |
|---|---|---|
| 离线 / POC / 单人用 | 1.4 + 2 ≈ **4 GB** | 8G 消费卡（4060）或 CPU + GGUF Q4 |
| 小规模在线（≤10 并发，4K） | 1.4 + 2 + 1.9 ≈ **6 GB** | 16G（4060Ti-16G / A4000 / T4）足够 |
| 20~32 并发 / 长上下文 | 1.4 + 2 + 6~14 ≈ **10~18 GB** | **24G 起步**（4090 / L4 / A10） |
| 高并发 | KV 主导，与权重几乎无关 | L4/A10 + FP8 KV 量化 + 限制 `max_model_len` |
| 全参 SFT | 1.4 + 1.4 + 5.6 + 激活 ≈ **10~12 GB** | 24G 单卡可跑 |
| QLoRA 微调 | ≈ **6~8 GB** | 16G 卡足够 |

**结论**：0.7B 权重只有 1.4 GB，**显卡选型基本由 KV Cache 和并发决定，而非模型大小**。生产最低建议 **24 GB（L4 / A10 / 4090）**；只有 PoC 才用 8G/16G。省显存优先级：**KV 量化(FP8) > 限制 max_model_len > 权重量化(INT8/AWQ) > 降并发**。

### 7.5 落地步骤

1. 查 `config.json` 拿 `num_hidden_layers / num_key_value_heads / head_dim / max_position_embeddings`
2. 按公式算权重 + 目标并发下的 KV
3. 加 2 GB 框架开销，再乘 **1.2 安全系数**
4. 用 vLLM 压测：固定 `max_model_len`、扫并发，测 **TTFT / TPOT / 吞吐**
5. 显存不够先降 `gpu_memory_utilization` 与 `max_num_seqs`，而不是换卡

---

## 附录 A：有会话表与消息表，为什么还需要长期记忆

一句话：**消息表存的是"发生过什么"（事件流），长期记忆存的是"由此得出了什么"（事实）。前者是流水，后者是结论。**

### A.1 本质差异

| 维度 | 会话表 + 消息表 | 长期记忆（Mem0） |
|---|---|---|
| 存什么 | 原始对话流水（含寒暄、指代、口误、AI 错误回答） | 抽取后的独立事实 |
| 访问方式 | **按时间序 / 按 session 顺序取** | **按语义相似度随机取**（topK 召回） |
| 作用域 | 天然绑定 `session_id`，跨会话不互通 | `user_id` 作用域，跨会话聚合 |
| 可变性 | append-only，**不可改**（审计举证需要） | 可 UPDATE / 合并 / 遗忘 |
| 规模 | 无限增长 | 受控（几百条量级） |
| 写入 | 同步、每轮必写、必须完整 | 异步、**有选择地写** |
| 一致性 | 强一致（事务、不能丢） | 最终一致（可丢、**可从消息表重建**） |

> 关键比喻：**消息表是 ODS 贴源层，长期记忆是从它派生出来的汇总层（物化视图）。**

### A.2 三个消息表填不了的坑

1. **Token 账算不平**：老用户 50 会话 × 20 轮 × 300 token ≈ 30 万 token，塞不进任何 prompt。要么每轮全表扫描 + LLM 归纳，要么预计算成一条事实。
2. **跨会话冷启动**：新会话第一轮当前 session 消息表是空的，而"这人是运维岗、上次问题没解决"散落在历史会话里。没有长期记忆，模型每轮都在跟陌生人对话。
3. **矛盾事实会并存**：append-only 意味着"上周说用 Java、这周说用 Go"两条都在，检索两条都召回，模型随机选一条。长期记忆有 UPSERT 语义，能覆盖成唯一最新事实——**这是"写时治理"，消息表永远做不到。**

### A.3 不是"表"不够，是缺三样东西

要用消息表当记忆，需要补上：

1. **抽取管线**（剥离噪声、指代、AI 错误回答，抽成事实）
2. **跨会话语义索引**（pgvector / 向量库 + 跨 session 检索）
3. **冲突治理**（去重、覆盖、置信度、遗忘）

补完之后会发现：**已经重写了一套记忆系统，只是架在了消息表上。**分界不是"有没有表"，而是"有没有从事件到事实的提炼"。

原文检索召回精度天然差：混着提问、寒暄、模型自己的错误输出。本项目 `chat-long-memory.service.ts:170` 特意只传 user 消息、禁止把知识库条文写成 user 记忆，就是在做这层"提纯"——**查询时做代价太高，只能在写入时做。**

### A.4 要承认：长期记忆是消息表的派生视图

- **可从消息表全量重建** → 不承载唯一权威数据，坏了可重算
- **最终一致** → 这轮写的记忆这轮用不上（本项目 `void this.longMemory.rememberTurn(...)`）
- **允许降级** → 无 `MEM0_API_KEY` 时整条链路静默跳过，说明是增强项而非必需项

> **消息表是不可变账本，长期记忆是账本上的一层可重算的物化视图。前者保证可审计可追溯，后者保证可检索可个性化。**

### A.5 什么时候真的不需要长期记忆

- 单用户单场景、无个性化要求（纯文档 QA 机器人）
- 会话生命周期短、用户不回流（一次性工具）
- 对"记错"零容忍、又没有人工纠错入口

这些场景下，消息表 + 会话内窗口（本项目 Redis 20 条）就够了。**代价不只是钱：记错一条事实会带着高置信度污染之后所有会话，比不记更糟。**

---

## 附录 B：Mem0 的原理与免费自托管

### B.1 结论

- **原理**：LLM 抽取事实 + 向量检索已有记忆 + LLM 决定 ADD/UPDATE/DELETE/NOOP。核心不在向量库，而在**写时治理**。
- **可免费自托管**：开源版 **Apache-2.0**，可商用、可改、可内网部署。免费的是"软件"，不是"模型调用"。

### B.2 `add` 的完整流水线

```
add(messages, { user_id, run_id })
 │
 ├─① Extraction（LLM 抽取）
 │    输入：本轮对话 + 已有记忆摘要（避免重复抽）
 │    输出：候选事实列表 ["用户是运维岗", "偏好给具体命令", ...]
 │
 ├─② 相似检索（向量）  每条 fact → embedding → 向量库 top-k
 │
 ├─③ Update 决策（LLM，关键）
 │    输入：[候选事实] + [top-k 已有记忆]
 │    输出：四选一
 │      ADD    新事实，库里没有
 │      UPDATE 与已有记忆冲突/互补 → 改写那条
 │      DELETE 与已有记忆矛盾 → 删掉旧的
 │      NOOP   已存在，什么都不做
 │
 ├─④ 落库
 │    向量库 upsert（user_id/agent_id/run_id 作为 filter 字段）
 │    history 表记录每次变更（old / new / event / 时间）← 可审计可回滚
 │    可选：entity store 实体链接、graph store 写实体-关系
 │
 └─⑤ 派生图记忆（Mem0ᵍ）：实体-关系存 Neo4j/Memgraph，支持多跳
```

`search(query, {user_id, run_id})` 三步：**embedding → 带 filter 的向量 top-k → 可选 rerank**。

**"Update" 是重点**：它把 append-only 的日志变成**可变事实库**。这正是消息表替代不了它的原因——消息表只能 ADD，Mem0 能做 UPDATE/DELETE。

### B.3 三种 scope

| scope | 语义 | 生命期 |
|---|---|---|
| `user_id` | 跨会话的画像、偏好、长期约束 | 永久 |
| `run_id` | 单次会话、任务、进度 | 会话结束可清 |
| `agent_id` | Agent 自身的角色设定、回答风格 | 跟随 Agent |

论文宣称（LOCOMO 基准）：相比全量上下文 **token 省约 90%、p95 延迟降约 91%**，比 OpenAI Memory 高 26%。属基准测试数字，只作量级参考。

### B.4 三种部署形态

| 形态 | 是什么 | 费用 | 本项目现状 |
|---|---|---|---|
| **OSS 库** | 进程内库，自己接 LLM、embedding、向量库 | 软件免费（Apache-2.0），模型调用自付 | `mem0ai@3.1.8` **已带 `./oss` 导出** |
| **自建服务** | Docker 起 mem0 server，走 REST | 软件免费 | `mem0-test/src/mem0-local-api-demo.mjs` 已在调 `localhost:8888` |
| **托管平台** | platform.mem0.ai，官方 SaaS | 按请求计费 | `chat-long-memory.service.ts:69` 用的是 `MemoryClient` |

`mem0ai@3.1.8` 的 `package.json` 有 `"./oss"` 导出，`dist/oss/index.d.ts:648` 是完整的 `Memory` 类（`fromConfig` / `add` / `search` / `update` / `getAll` / `history`），支持 reranker、historyStore、entity store。

### B.5 改造示例（云 → 自托管）

```ts
import { Memory } from 'mem0ai/oss';   // 注意是 mem0ai/oss，不是 mem0ai

const memory = Memory.fromConfig({
  llm: {
    provider: 'openai',
    config: { apiKey, baseURL, model: 'qwen-plus' },   // 兼容 OpenAI 协议即可，也能指向本地 vLLM
  },
  embedder: {
    provider: 'openai',
    config: { apiKey, baseURL, model: 'text-embedding-v3', embeddingDims: 1024 },
  },
  vectorStore: {
    provider: 'pgvector',            // 复用已有 PG，先 CREATE EXTENSION vector
    config: {
      host, port, dbname: 'knowledge_hub', user, password,
      collectionName: 'kh_memories', dimension: 1024,
    },
  },
  historyStore: { provider: 'sqlite', config: { historyDbPath: './mem0_history.db' } },
  customInstructions: '只用用户说的话抽取记忆，知识库条文不要写成用户记忆。',
});
```

**API 差异（必须改）**：OSS 版是 camelCase，云版是 snake_case filters。

```ts
// 原先：memory.search(query, { filters: { user_id } })
const userRes = await memory.search(query, { userId, limit: this.topK });
const sessRes = await memory.search(query, { userId, runId: sessionId, limit: this.topK });
await memory.deleteAll({ userId, runId: sessionId });
```

### B.6 自托管的 6 个坑

1. **向量库选型比云版麻烦**。`pgvector` 最省事（复用现有 PG）；`redis` provider **需要 RediSearch/RedisJSON（redis-stack），普通 `redis:7` 不行**——`mem0-test/docker-compose.yml` 起的是普通 Redis，切 redis provider 会直接失败。
2. **embedding 维度必须一致**。换 embedding 模型等于所有记忆失效。生产建议显式写 `dimension`。
3. **Node 端 OSS 功能会比 Python 端滞后**（图记忆、最新衰减策略等通常先上 Python），选型前要核对特性是否存在。
4. **成本没有消失，只是转移**。一次 `add` ≈ 2 次 LLM + 2 次 embedding；一次 `search` ≈ 1 次 embedding。真正零成本需本地模型（如 0.7B 做抽取 + `bge-m3` 做 embedding），但抽取质量会明显下降，必须自评。
5. **写并发与幂等**。Mem0 的 update 是"读-判-写"，同一用户并发写有竞态。本项目 `rememberTurn` 是 `void` 异步触发，高并发下会重复记忆，需要按 `userId` 串行队列或幂等键。
6. **可观测性**。自托管后 `history` 表是唯一审计手段，建议把 extract/update 的 prompt 与输出都进 Langfuse（本项目已有）。

### B.7 务实的判断

Mem0 真正有价值的是三件事：**四操作治理、history 可审计、实体链接**。向量检索本身谁都能写。

- 只要"跨会话记住用户偏好" → PG 加一张 `user_profile` 表 + 一个抽取 prompt 就够，可控性高于 Mem0
- 要"记忆互相冲突、需自动覆盖、需可追溯" → 用 Mem0 OSS，别自己写
- 要免运维 + 可视化 → 付费用平台

本项目现在把 `MemoryClient` 换成 `mem0ai/oss` + pgvector 是**改动最小、成本降到 0 的路径**，代价是失去平台面板与多语言一致的演进速度。

---

## 附录 C：已知短板与自测清单

### C.1 本项目的已知短板（主动抛给面试官）

1. `summarizationMiddleware` 的摘要不落库 → 长会话每次重算，浪费 token 且不稳定，应把摘要作为特殊 message 持久化。
2. 窗口按**条数**而非 **token** 计（20 条可能是 20 句也可能是 20 段）→ 应改按 token 预算 + `trimMessages`。
3. 长期记忆没有命中率/噪声评测 → 最怕"召回了错的事实还带高置信度"，需离线评测集。
4. Mem0 黑盒不可控（多一次网络往返、有延迟和成本）→ 高并发可换本地向量库 + 自研抽取。
5. 缺单条记忆纠错入口，只有 `deleteAll` 级联删除；缺 `source_session_id` 溯源字段。
6. 未使用 LangGraph checkpointer → 无法从图中间步骤重试，长任务失败需整轮重跑。

### C.2 自测清单

- [ ] 能说清 LangChain 与 LangGraph 的分工，并指出"LangChain v1 的 createAgent 就是 LangGraph"
- [ ] 能解释 reducer 为什么必须返回增量、并行节点为什么不能就地改 state
- [ ] 能画出 ReAct 的条件边（agent → tools → agent → END）
- [ ] 能说出 checkpoint 的四个用途，并区分"执行态"与"长期记忆"
- [ ] 能完整描述 tool_call_id 配对的回灌闭环，并列出 3 个以上工程坑
- [ ] 能讲清本项目三层记忆架构与降级路径
- [ ] 能用"脱离对话能否独立成立"一句话区分短/长期记忆
- [ ] 能回答"有消息表为什么还要长期记忆"，并说出"长期记忆是消息表的派生视图"
- [ ] 能讲清 Mem0 的 Extract + Update 两阶段与四操作
- [ ] 能默写显存公式，并说明为什么 0.7B 的选型由 KV Cache 决定

