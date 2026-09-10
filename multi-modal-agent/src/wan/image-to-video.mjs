/**
 * 图生视频 — wan2.6-i2v-flash（万相图生视频·极速版）
 * =====================================================================
 * 技术路线：DashScope「原生 SDK」dashscope-sdk-official → VideoSynthesis
 *
 * 说明：本 SDK 的定位与用法统一写在 src/wan/image-edit.mjs 的头部注释里，不再重复
 *
 * 与文生视频（t2v）的差异只有两点：
 *   1. img_url 必填：作为视频的「首帧参考图」，模型从这张图开始动起来；
 *   2. 分辨率用 resolution 档位（'720P'/'1080P'），而不是 size 的 宽*高。
 *   prompt 此时描述的是「运动 / 镜头」，不是静态画面内容。
 *
 * 同样是异步任务：call() 内部封装了提交 + 轮询，会阻塞到出结果。
 *
 * 运行：node src/wan/image-to-video.mjs
 * 前置：.env 中 OPENAI_API_KEY = DashScope 的 API Key
 * 输出：output-wan-image-to-video.mp4（脚本自动下载到项目根目录）
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

console.log('model: wan2.6-i2v-flash');
console.log('creating video task...');

const result = await client.call({
  model: 'wan2.6-i2v-flash',
  prompt: '女孩缓缓转头，海风吹动头发，阳光洒在沙滩上，镜头缓慢推进', // 运动/镜头描述
  img_url: 'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg', // 首帧参考图，图生视频必填
  resolution: '720P', // 图生视频用 resolution（如 720P / 1080P）
  prompt_extend: true, // 是否自动扩写提示词
  duration: 5, // 视频时长（秒）
});

// 异步任务的结果要用 task_status 判断成功与否
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
// 视频 URL 有效期较短，及时下载保存
const videoResponse = await fetch(videoUrl);
writeFileSync('output-wan-image-to-video.mp4', Buffer.from(await videoResponse.arrayBuffer()));
console.log('Saved to output-wan-image-to-video.mp4');
