/**
 * delete.mjs — Milvus 数据删除脚本
 *
 * 功能：演示三种删除方式——按主键单条删除、按主键批量删除、按条件过滤删除
 *
 * 流程：连接 Milvus → 单条删除(id=diary_005) → 批量删除(id in [...]) → 条件删除(mood==sad)
 */

import "dotenv/config";
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

// ========== 常量配置 ==========
const COLLECTION_NAME = 'ai_diary';

// ========== 初始化 Milvus 客户端 ==========
const client = new MilvusClient({
  address: 'localhost:19530'
});

async function main() {
  try {
    console.log('Connecting to Milvus...');
    await client.connectPromise;
    console.log('✓ Connected\n');

    // ========== 1. 按主键删除单条数据 ==========
    console.log('Deleting diary entry...');
    const deleteId = 'diary_005';

    const result = await client.delete({
      collection_name: COLLECTION_NAME,
      filter: `id == "${deleteId}"`
    });

    console.log(`✓ Deleted ${result.delete_cnt} record(s)`);
    console.log(`  ID: ${deleteId}\n`);

    // ========== 2. 按主键批量删除 ==========
    // 使用 in 操作符匹配多个主键
    console.log('Batch deleting diary entries...');
    const deleteIds = ['diary_002', 'diary_003'];
    const idsStr = deleteIds.map(id => `"${id}"`).join(', ');

    const batchResult = await client.delete({
      collection_name: COLLECTION_NAME,
      filter: `id in [${idsStr}]`
    });

    console.log(`✓ Batch deleted ${batchResult.delete_cnt} record(s)`);
    console.log(`  IDs: ${deleteIds.join(', ')}\n`);

    // ========== 3. 按条件过滤删除 ==========
    // 通过 filter 表达式删除满足条件的所有记录（不依赖主键）
    console.log('Deleting by condition...');
    const conditionResult = await client.delete({
      collection_name: COLLECTION_NAME,
      filter: `mood == "sad"`
    });

    console.log(`✓ Deleted ${conditionResult.delete_cnt} record(s) with mood="sad"\n`);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
