/**
 * Mem0 云端 API 基础演示（官方 MemoryClient）
 *
 * 覆盖 Memory API 完整能力：add 添加 / search 搜索 / getAll 列出 /
 * get 获取单条 / update 更新 / history 变更历史 / deleteAll 清理。
 * 默认只演示 search（避免反复写入线上记忆），取消相应注释即可体验其他接口。
 *
 * 前置：.env 中配置 MEM0_API_KEY
 * 运行：node src/mem0-test.mjs            （演示搜索）
 *        node src/mem0-test.mjs --cleanup （清理该用户全部记忆）
 */
import 'dotenv/config';
import { MemoryClient } from 'mem0ai';

// 本示例使用的用户标识：Mem0 记忆按 user_id 隔离，换一个 id 即换一份记忆
const USER_ID = 'demo-user';

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function main() {
  // MemoryClient 连接 Mem0 云端服务，鉴权使用 MEM0_API_KEY
  const client = new MemoryClient({ 
    apiKey: process.env.MEM0_API_KEY
  });

  // const conversation = [
  //   { role: 'user', content: '我是素食主义者，而且对坚果过敏。' },
  //   { role: 'assistant', content: '好的，我会记住你的饮食偏好。' },
  //   { role: 'user', content: '我住在北京，平时喜欢跑步。' },
  //   { role: 'assistant', content: '已记录：北京、爱好跑步。' },
  // ];

  // const added = await client.add(conversation, { userId: USER_ID });
  // log('添加记忆', added);

  // 语义搜索：用自然语言问题召回最相关的记忆
  //   filters.user_id 限定只搜该用户；topK 返回最相关的 5 条
  const searchResult = await client.search('用户的饮食限制是什么？中文回答', {
    filters: { user_id: USER_ID },
    topK: 5
  });
  log('搜索记忆', searchResult);

  // const allMemories = await client.getAll({
  //   filters: { user_id: USER_ID },
  //   pageSize: 10,
  // });
  // log('列出全部记忆', allMemories);

//   const firstMemory = allMemories.results?.[0] ?? searchResult.results?.[0];
//   if (firstMemory?.id) {
//     const memory = await client.get(firstMemory.id);
//     log('获取单条记忆', memory);

//     const updated = await client.update(firstMemory.id, {
//       text: `${memory.memory ?? firstMemory.memory}（已通过示例脚本更新）`,
//     });
//     log('更新记忆', updated);

//     const history = await client.history(firstMemory.id);
//     log('记忆变更历史', history);
//   }

//   if (process.argv.includes('--cleanup')) {
//     const deleted = await client.deleteAll({ userId: USER_ID });
//     log('清理测试数据', deleted);
//   } else {
//     console.log('\n提示: 运行 `node src/mem0-test.mjs --cleanup` 可删除本次测试用户的全部记忆');
//   }
}

main().catch((error) => {
  console.error('\n执行失败:', error.message ?? error);
  if (error.suggestion) {
    console.error('建议:', error.suggestion);
  }
  process.exit(1);
});
