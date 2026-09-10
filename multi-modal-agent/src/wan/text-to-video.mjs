/**
 * 文生视频 — wan2.6-t2v（万相视频生成）
 * =====================================================================
 * 技术路线：DashScope「原生 SDK」dashscope-sdk-official → VideoSynthesis
 *
 * 说明：本 SDK 的定位与用法统一写在 src/wan/image-edit.mjs 的头部注释里，不再重复
 *
 * 与图像生成最大的不同：视频生成是「异步任务」
 *   - 提交任务后返回 task_id，需要不断查询直到状态变成 SUCCEEDED；
 *   - 本脚本用的 VideoSynthesis.call() 已经把「提交 + 轮询」封装好了，
 *     调用会一直阻塞到任务结束，所以单次运行通常要等几十秒到几分钟。
 *
 * 参数易错点：
 *   文生视频用 size（如 '1280*720'），图生视频用 resolution（如 '720P'），二者不通用。
 *
 * 运行：node src/wan/text-to-video.mjs
 * 前置：.env 中 OPENAI_API_KEY = DashScope 的 API Key
 * 输出：output-wan-text-to-video.mp4（脚本自动下载到项目根目录）
 * =====================================================================
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { Configuration, VideoSynthesis } from 'dashscope-sdk-official';

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
// 视频生成是异步任务；VideoSynthesis.call 内部会提交任务并轮询至完成
const client = new VideoSynthesis(configuration);

console.log('model: wan2.6-t2v');
console.log('creating video task...');

const result = await client.call({
  model: 'wan2.6-t2v',
  prompt: '一只橘猫在窗台上晒太阳，微风吹动窗帘，镜头缓慢推进，电影质感', // 画面与运动描述
  size: '1280*720', // 文生视频用 size（宽*高），与图生视频的 resolution 不同
  prompt_extend: true, // 是否自动扩写提示词
  duration: 5, // 视频时长（秒）
  watermark: false, // 是否添加「AI 生成」水印
});

// 任务失败时 SDK 不抛异常，需要读 task_status 判断
const taskStatus = result.output?.task_status;
console.log('task_status:', taskStatus);

if (taskStatus === 'FAILED') {
  throw new Error(result.output?.message ?? result.message ?? 'Task failed');
}

const videoUrl = result.output?.video_url;
if (!videoUrl) {
  throw new Error(`No video URL in response: ${JSON.stringify(result)}`);
}

console.log('video URL:', videoUrl);
// 视频 URL 有效期较短，运行结束前务必落地保存
const videoResponse = await fetch(videoUrl);
writeFileSync('output-wan-text-to-video.mp4', Buffer.from(await videoResponse.arrayBuffer()));
console.log('Saved to output-wan-text-to-video.mp4');
