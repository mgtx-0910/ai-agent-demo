# 索引、图谱抽取与检索取数（实现细节）

主 README 的 5.2 / 5.3 / 5.4 讲的是"有哪些环节"，本文补三件容易问错的事：

1. 版本回滚时，三套索引到底删不删、重建不重建；
2. 实体关系按什么粒度抽（块还是全文），代价和副作用是什么；
3. 问答检索时，实体 / 关系 / 文档 ID / 分块 ID 分别从哪来，拿到之后怎么用。

代码位置都在 `src/pipeline/`、`src/ai/`，行号以当前实现为准。

---

## 一、三套索引与回滚行为

### 1.1 先分清"数据"和"索引"

原始数据只有两份：

| 数据 | 存储 | 内容 |
|---|---|---|
| 文档元数据 | PostgreSQL `kh_document` | 标题、分类、状态、可见性、发布时间 |
| 文档正文 | MongoDB `DocumentContent` | Markdown 正文、版本历史 |

其余全是**可重建的派生副本**：

| 派生数据 | 存储 / 索引名 | 粒度 | 谁在用 |
|---|---|---|---|
| RAG 向量索引 | ES `kh_chunk` | 每篇文档 N 个块，`_id` = `chunkId` | AI 问答混合检索 |
| 全文搜索索引 | ES `kh_document` | 每篇文档 1 条，`_id` = `documentId` | 搜索页 `searchDocuments` |
| 知识图谱 | Neo4j | 文档节点 + 块节点 + 实体 + 关系 | 图谱问答、图谱可视化 |

所以"清索引"删的是**副本**，丢了可以从 PG + Mongo 全量重建（`BUILD_ALL` / 重新发布）。

### 1.2 回滚本身不碰索引

```128:146:knowledge-hub-backend/src/document/document-engagement.controller.ts
  @Post(':id/versions/:versionId/restore')
  async restore(...) {
    const version = await this.versions.get(id, versionId, user);
    return this.documents.update(id, { title, content, summary }, user);
  }
```

回滚 = 把旧正文写回 `update()`，历史版本一条不删（`recordContentChange` 追加 `version + 1`）。索引动不动，由 `update()` 末尾的 `syncPipelineAfterUpdate` 决定：

```652:682:knowledge-hub-backend/src/document/document.service.ts
private async syncPipelineAfterUpdate(doc, oldStatus, newStatus, contentChanged, visibilityChanged) {
  if (wasPublished && !isPublished) { await this.safeUnpublish(doc.id); return; }
  if (isPublished && contentChanged && !this.reviewService.isRequireApproval()) {
    await this.safePublish(doc); return;   // ← 回滚走这条
  }
  if (isPublished && visibilityChanged) { ... updateVisibility ... }
}
```

### 1.3 各索引对"重建"的反应不同

| 索引 | 重建方式 | 原因 |
|---|---|---|
| RAG `kh_chunk` | **先删后建**：`deleteByQuery(term: document_id)` → 分块 → embedding → bulk | `chunkId` 由"文档 ID + 块序号"算出，正文字数一变块边界就变；不先删会同时存在新旧两版块，检索召回重复内容 |
| KG Neo4j | **先删后建**：`DETACH DELETE` 文档与块，再清孤儿实体 → 重建 | 实体是 `MERGE` 上去的，旧正文里独有的实体如果不清理，会残留成"幽灵节点"，关系边还会翻倍 |
| ES 全文 `kh_document` | **不清，直接覆盖** | `_id` 就是 `documentId`，一条记录对应一篇文档，整篇 upsert 天然幂等 |

```153:183:knowledge-hub-backend/src/pipeline/pipeline.orchestrator.ts
  // 先清旧块，避免重复发布时脏数据残留
  await this.vectorIndexService.deleteByDocId(doc.id);
  ...
  await this.vectorIndexService.indexChunks(chunks);
```

```182:183:knowledge-hub-backend/src/pipeline/graph-build.service.ts
    // 先清再建，避免重复发布导致边/节点翻倍
    await this.deleteForDocument(doc.id);
```

注意是**按文档粒度**删（`term: { document_id }`），不会波及其它文档。

### 1.4 两种"回滚但不重建"的情况

- **开了审核模式**（`DOCUMENT_REQUIRE_APPROVAL=true`）：条件里 `!isRequireApproval()` 不成立，回滚后索引不动，要等再次发布 / 审核通过才重建。期间搜索和问答命中的仍是旧正文，属刻意行为。
- **文档不是 Published**（草稿 / 归档 / 待审核）：`wasPublished` 与 `isPublished` 都是 false，一个分支都不进。

### 1.5 两个风险

- **删和建不是原子操作**：`reindexOne` 里 `deleteByDocId` 先执行，若随后 embedding 抛错，这篇文档在 `kh_chunk` 里会短暂为空，只能靠再触发一次索引或全量重建补回；失败只记日志、不重试。
- **MQ 投递失败不回滚正文**：`safePublish` 吞掉异常只 `warn`，结果是"正文已按回滚版本保存，索引还停在旧内容"。

---

## 二、实体抽取：按块，不是按全文

### 2.1 分块参数

| 配置 | 默认 | 实际 |
|---|---|---|
| `RAG_CHUNK_SIZE` | 512 token | × 2 字符/token = **1024 字符** |
| `RAG_CHUNK_OVERLAP` | 64 token | = 128 字符重叠 |

Markdown 感知递归切分（优先 `\n# `，其次代码块、段落），切完若块内没有标题行，会把上一章节标题补成前缀，保证单块自带上下文。

```41:60:knowledge-hub-backend/src/pipeline/chunking.service.ts
    const chunkSize = Math.floor(chunkSizeTokens * ChunkingService.CHARS_PER_TOKEN);
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      keepSeparator: true,
      separators: ['\n# ', ...RecursiveCharacterTextSplitter.getSeparatorsForLanguage('markdown')],
    });
```

### 2.2 抽取是逐块一次 LLM 调用

```259:279:knowledge-hub-backend/src/pipeline/graph-build.service.ts
        // ④ 抽实体关系并落图；单块失败不阻断其余块（图已先清过）
        try {
          extracted = await this.extractionService.extract(
            chunk.content, chunk.heading, doc.title,
          );
        } catch (error) {
          ...
          extracted = { entities: [], relations: [] };
        }
        extracted.chunkId = chunk.chunkId;
        const written = await this.writeExtraction(session, extracted);
```

`for` 循环串行 `await`，单块失败降级为空结果。每次调用喂给模型的是：文档标题 + 章节标题 + 块正文（再兜底 `slice(0, 4000)`），用 `withStructuredOutput` 约束成 `{entities, relations}`，默认 `qwen-plus`、`temperature 0.1`、超时 60s。

数量上限：`KG_MAX_ENTITIES=12`、`KG_MAX_RELATIONS=15`，超出截断；关系两端不在本块实体集合内的直接丢弃。

### 2.3 按块抽的四个后果

1. **跨块关系抽不到**：A 在块 1、B 在块 2 时，`A—B` 这条边不会产生。这是粒度换成本。
2. **实体自动聚合成全局节点**：写入时 `MERGE (e:KnowledgeEntity {name: $name})`，同名实体跨块、跨文档共用一个节点，再靠 `(块)-[:MENTIONS]->(实体)` 回指。图的连通性来自**实体名**，不是模型在全文上做的一次推理。
3. **重叠区重复抽**：128 字符 overlap 会让相邻块都抽到同一实体。`MERGE` 保证节点不重复，但 `description` 会被后处理的块覆盖（仅当新描述非空）。
4. **成本随块数线性增长**：1 万字 ≈ 10 块 ≈ 10 次串行 LLM 调用，这是全量重建很慢的主因。

---

## 三、问答检索时，ID 与关系从哪来

### 3.1 通道 A：ES 取到 chunkId + documentId

```33:66:knowledge-hub-backend/src/ai/hybrid-retrieval.service.ts
  async retrieve(query, topK = 5, user?): Promise<ChunkHit[]> {
    const queryVector = await this.embedQuery(query);
    const fused = await this.vectorIndex.searchHybrid({ query, queryVector, hybridTopK, rrfC, scope });
    const reranked = await this.reranker.rerank(query, fused, fused.length);
    const kept = reranked.filter((hit) => hit.score >= this.minScore);
    return kept.slice(0, topK);
  }
```

链路：query 向量化 → `kh_chunk` 的 BM25（标题权重 2）+ kNN 并行召回 → RRF 融合（C=60）→ reranker 精排 → `RAG_MIN_SCORE=0.4` 过滤 → topK。

命中结构里 ID 齐全：

```35:45:knowledge-hub-backend/src/pipeline/types/pipeline.types.ts
export interface ChunkHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  heading: string | null;
  score: number;
  ...
}
```

可见性是在 ES 查询里做 `filter`（`is_public` / `author_id` / `team_id`），不是召回后再筛。

### 3.2 通道 B：Neo4j 取到实体 + 关系 + documentId

`retrieveForChat` 用三条 Cypher 顺序查（同一 session，避免并发丢边）：

**① 找实体**——短词对 `name` / `aliases` 做相等或前后缀匹配，不用 `CONTAINS`；非超管要求实体出现在"当前用户可见文档的块"里（`EXISTS { ... }` 子查询）；排序为全名相等 > 前后缀 > 别名，再按名字长度升序；默认 `limit=8`，上限 20。

```568:601:knowledge-hub-backend/src/pipeline/graph-build.service.ts
        MATCH (e:KnowledgeEntity)
        WHERE any(kw IN $kws WHERE
          toLower(e.name) = toLower(kw)
          OR toLower(replace(replace(e.name, '《', ''), '》', '')) STARTS WITH toLower(kw)
          OR toLower(e.name) ENDS WITH toLower(kw)
          OR any(a IN coalesce(e.aliases, []) WHERE ...)
        )
        AND ($unrestricted OR EXISTS {
          MATCH (d:KnowledgeDocument)-[:HAS_CHUNK]->(:DocumentChunk)-[:MENTIONS]->(e)
          WHERE ${neo4jDocumentAccessWhere('d')}
        })
        RETURN e.name AS name, e.type AS type, e.description AS description
        ORDER BY ... LIMIT $limit
```

模型爱传整句，所以入参先被 `splitGraphKeywords` 按空格 / `/` 拆成短词。

**② 取关系**——只取本轮命中实体**之间**的边，不向图上扩散；端点两端都必须在 `names` 里：

```619:625:knowledge-hub-backend/src/pipeline/graph-build.service.ts
        MATCH (a:KnowledgeEntity)-[r:RELATED_TO]->(b:KnowledgeEntity)
        WHERE a.name IN $names AND b.name IN $names
        RETURN a.name AS source,
               coalesce(nullif(r.relation, 'RELATED_TO'), '关联') AS relation,
               b.name AS target
```

**③ 反查来源文档**——三跳路径 `文档 -[HAS_CHUNK]-> 块 -[MENTIONS]-> 实体`，再叠可见性：

```643:648:knowledge-hub-backend/src/pipeline/graph-build.service.ts
        MATCH (d:KnowledgeDocument)-[:HAS_CHUNK]->(:DocumentChunk)-[:MENTIONS]->(e:KnowledgeEntity)
        WHERE e.name IN $names
          AND ($unrestricted OR ${neo4jDocumentAccessWhere('d')})
        RETURN DISTINCT d.id AS documentId, d.title AS title
        LIMIT 8
```

返回体：

```14:23:knowledge-hub-backend/src/pipeline/graph-build.service.ts
export type GraphChatHit = {
  query: string;
  entities: Array<{ name; type; description }>;
  relations: Array<{ source; relation; target }>;
  documents: Array<{ documentId; title }>;
};
```

### 3.3 拿到之后：Agent 工具编排

```
意图分类 classify() → plan { intent, query, graphQueries, allowRetrieve, allowGraph, allowWeb }
        │
        ├── 按 plan 挂工具：retrieve_knowledge / rewrite_query / retrieve_graph / web_search
        │    （首次两个检索要求并行调用）
        ▼
retrieve_knowledge → retrieveAndGrade：检索 → LLM 判切题 → eval.ok
        │  ok=false → 返回 insufficient → 模型被迫 rewrite_query → 再查（本轮最多两次）
        ▼
packRetrieveResult：写 data-sources / source-document；context 拼成 "[n] 标题 / 章节\n正文"
retrieve_graph     ：data-graph 推前端做可视化；context 用 formatGraphContext 只给"关系 + 来源标题"
        ▼
模型作答标 [n] → 正则提取被引编号 → 丢弃未引用条目 → 转 ChatSource 返回
```

图谱工具的实现：

```305:319:knowledge-hub-backend/src/ai/ai-stream.service.ts
            const hit = await graph.retrieveForChat(keywords, 8, accessFromUser(user));
            writer.write({ type: 'data-graph', data: hit });
            return {
              query: hit.query, entities: hit.entities,
              relations: hit.relations, documents: hit.documents,
              context: formatGraphContext(hit),
              insufficient: !hit.entities.length && !hit.relations.length,
            };
```

`formatGraphContext` 只输出"关系：A → B（X）"和"来源文档：标题"，并附一句"以上只说明实体之间的关系，不能当制度原文"，防止模型把图谱当条文引用。

知识库工具产出的引用条目：

```828:835:knowledge-hub-backend/src/ai/ai-stream.service.ts
  const sources = hits.map((hit, i) => ({
    index: offset + i + 1,
    documentId: hit.documentId,
    documentTitle: hit.documentTitle,
    heading: hit.heading,
    excerpt: excerpt(hit.content),
    score: hit.score,
  }));
```

### 3.4 已知缺口：chunkId 出不了服务端

`ChatSource` 里没有 `chunkId`：

```1:10:knowledge-hub-backend/src/ai/chat.types.ts
export interface ChatSource {
  index: number;
  documentId: string;
  documentTitle: string;
  heading: string | null;
  excerpt: string;
  score: number;
}
```

也就是说：

- `chunkId` 只作为 ES 的 `_id` 参与检索与删除，**不暴露给前端**；
- 图谱通道只回 `documentId` + `title`，**没有分块级定位**（③ 的 `RETURN` 可以把 `c.chunkId, c.heading, c.content` 一起带出来，再把 `GraphChatHit.documents` 扩成带块列表）；
- 三套索引（全文 / 向量 / 图）唯一稳定的 join key 是 **`documentId`**。

想做"点引用跳到原文对应段落"，需要把 `chunkId` 透传到 `ChatSource`，并让前端按 `chunkIndex` 定位锚点——目前没有这层。
