/**
 * create.mjs —— 初始化 ES 索引并写入示例数据（幂等，可重复执行）
 *
 * 本文件演示 Elasticsearch 最基础的三个概念：
 *   1. 索引（Index）  ：相当于关系型数据库里的「表」，数据都存进索引里
 *   2. 映射（Mapping） ：定义每个字段的类型与分词方式，相当于「建表语句」
 *   3. 批量写入（Bulk）：一条请求同时写入多条文档，比逐条 index 高效得多
 *
 * 使用的分词器是 IK 中文分词（镜像里已内置）：
 *   - ik_max_word：尽可能切出最细粒度的词，用于「索引端」，召回更全
 *   - ik_smart   ：按语义智能切分，用于「搜索端」，结果更精准
 *
 * 运行：node src/create.mjs
 */
import { Client } from '@elastic/elasticsearch';

// 连接本地 ES（对应 docker-compose 里 9300 宿主端口，单节点、免认证）
const client = new Client({
  node: 'http://localhost:9300'
});

// 演示用的索引名（相当于表名）
const INDEX_NAME = 'travel_journal';

/** 创建索引：若已存在则跳过（幂等），否则定义 mapping 后创建 */
async function createIndex() {
  // indices.exists：查询索引是否存在（返回布尔值）
  const exists = await client.indices.exists({ index: INDEX_NAME });
  if (exists) {
    console.log(`ℹ️ 索引已存在: ${INDEX_NAME}`);
    return;
  }

  // indices.create：创建索引，mappings.properties 定义字段结构
  await client.indices.create({
    index: INDEX_NAME,
    mappings: {
      properties: {
        // text 类型：全文检索，可分词。索引用 ik_max_word 切细，搜索用 ik_smart 智能切
        note_title: { type: 'text', analyzer: 'ik_max_word', search_analyzer: 'ik_smart' },
        note_body: { type: 'text', analyzer: 'ik_max_word', search_analyzer: 'ik_smart' },
        // keyword 类型：不分词，适合精确匹配、过滤、聚合（如标签、情绪）
        tags: { type: 'keyword' },
        mood: { type: 'keyword' },
        // integer / date：数值与时间字段，支持范围查询与排序
        priority: { type: 'integer' },
        created_at: { type: 'date' },
        updated_at: { type: 'date' }
      }
    }
  });

  console.log(`✅ 索引创建成功: ${INDEX_NAME}`);
}

/** 写入 3 条演示数据（旅行日记场景） */
async function seedData() {
  const now = new Date().toISOString();
  const docs = [
    {
      note_title: '杭州西湖半日游',
      note_body: '早上绕湖慢跑，中午吃片儿川，下午在断桥拍照放松。',
      tags: ['旅行', '周末', '杭州'],
      mood: 'relaxed',
      priority: 2,
      created_at: now,
      updated_at: now
    },
    {
      note_title: '城市骑行计划',
      note_body: '周六沿江骑行 20 公里，带上水和简易修车工具。',
      tags: ['运动', '骑行'],
      mood: 'energetic',
      priority: 3,
      created_at: now,
      updated_at: now
    },
    {
      note_title: '雨天宅家阅读',
      note_body: '下雨天在家看书，整理本周笔记并做晚餐。',
      tags: ['生活', '阅读'],
      mood: 'calm',
      priority: 1,
      created_at: now,
      updated_at: now
    }
  ];

  // bulk 批量写入格式：每两条一组——先「动作行」{ index: {_index} } 再「数据行」doc
  // flatMap 把 [动作, 数据, 动作, 数据, ...] 拍平成一个数组
  const operations = docs.flatMap((doc) => [{ index: { _index: INDEX_NAME } }, doc]);
  // refresh: true —— 写入后立即刷新，使文档立即可被搜索（默认是近实时，约 1 秒）
  await client.bulk({ refresh: true, operations });
  console.log(`✅ 初始化数据完成，共 ${docs.length} 条`);
}

async function run() {
  await createIndex();
  await seedData();
}

run().catch((err) => {
  console.error('❌ 创建阶段失败:', err);
  process.exit(1);
});
