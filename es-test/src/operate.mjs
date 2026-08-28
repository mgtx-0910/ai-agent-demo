/**
 * operate.mjs —— 演示 ES 文档的增删改查（CRUD）与全文检索
 *
 * 操作的对象是 create.mjs 创建的 travel_journal 索引：
 *   1. create（增）：index API   —— 按 id 新增一条文档
 *   2. read  （查）：get API     —— 按 id 读取整条文档
 *   3. update（改）：update API  —— 局部更新（只改传入的字段，其他不动）
 *   4. search（搜）：search API  —— match 全文检索（IK 智能分词）
 *   5. delete（删）：delete API  —— 按 id 删除文档
 *
 * 注意：run() 里默认只执行删除（前面的操作被注释掉），
 *       想逐个演示就把对应行取消注释即可。
 *
 * 运行：node src/operate.mjs
 */
import { Client } from '@elastic/elasticsearch';

// 连接本地 ES（与 create.mjs 相同）
const client = new Client({
  node: 'http://localhost:9300'
});

const INDEX_NAME = 'travel_journal';

/** 新增：client.index —— 不指定 id 时 ES 自动生成；指定则按指定 id 写入 */
async function createDocument() {
  const now = new Date().toISOString();
  const res = await client.index({
    index: INDEX_NAME,
    document: {
      note_title: '夜跑复盘',
      note_body: '今天夜跑 5 公里，配速稳定，结束后做了拉伸。',
      tags: ['运动', '夜跑'],
      mood: 'focused',
      priority: 2,
      created_at: now,
      updated_at: now
    },
    refresh: true // 立即刷新，方便随后 get 立即可见
  });

  // 返回值 res._id 就是 ES 生成的文档 id（后续 get/update/delete 都靠它定位）
  console.log('✅ 新增成功，ID =', res._id);
  return res._id;
}

/** 查询：client.get —— 按 id 取文档，字段在 res._source 里 */
async function getDocument(docId) {
  const res = await client.get({
    index: INDEX_NAME,
    id: docId
  });
  console.log('📖 查询结果:', res._source);
}

/**
 * 更新：client.update —— 只更新 doc 里给出的字段（局部更新）
 * 与「整条覆盖写入」不同，update 不会动未提到的字段
 */
async function updateDocument(docId) {
  await client.update({
    index: INDEX_NAME,
    id: docId,
    doc: {
      note_body: '今天夜跑 6 公里，状态不错，拉伸后恢复很快。',
      tags: ['运动', '夜跑', '训练'],
      updated_at: new Date().toISOString()
    },
    refresh: true
  });
  console.log('🔄 更新成功');
}

/** 搜索：client.search —— match 全文检索，query 文本会被 ik_smart 智能分词后匹配 */
async function searchDocuments() {
  const res = await client.search({
    index: INDEX_NAME,
    query: {
      match: {
        note_body: {
          query: '慢跑以及骑行的数据',
          analyzer: 'ik_smart' // 指定搜索分词器，与索引里定义的 search_analyzer 一致
        }
      }
    }
  });

  // 命中结果在 res.hits.hits 数组里，_source 是文档本体，_score 是相关度打分
  const rows = res.hits.hits.map((item) => ({
    id: item._id,
    ...item._source
  }));
  console.log('🔍 搜索结果:', rows);
}

/** 删除：client.delete —— 按 id 删除文档 */
async function deleteDocument(docId) {
  await client.delete({
    index: INDEX_NAME,
    id: docId,
    refresh: true
  });
  console.log('🗑️ 删除成功');
}

async function run() {
  // 想逐个演示：取消下面的注释即可
  // const docId = await createDocument();   // 1. 新增
  // await getDocument(docId);               // 2. 按 id 查询
  // console.log('docId', docId);
  const docId = 'IeGE550BzfcVl_0hJv5m'; // 已存在的文档 id，可直接对其操作
  // await updateDocument(docId);            // 3. 局部更新
  // await getDocument(docId);               // 4. 更新后再查，看字段变化
  // await searchDocuments();                // 5. 全文检索

  await deleteDocument(docId); // 默认只执行删除
}

run().catch((err) => {
  console.error('❌ 操作阶段失败:', err);
  process.exit(1);
});
