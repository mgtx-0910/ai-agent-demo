/**
 * 图像编辑 — wan2.6-image（万相图像编辑 / 图文混排）
 * =====================================================================
 * 技术路线：DashScope「原生 SDK」dashscope-sdk-official
 *
 * 关于 dashscope-sdk-official —— 阿里云百炼（DashScope）官方 Node.js SDK
 *  （全项目只在此处说明一次，其余 wan 脚本不再重复）
 *   作用：把百炼的原生 HTTP 接口（multimodal-generation / video-synthesis …）
 *         封装成「一类能力一个类」，免去自己拼 URL、加鉴权头、处理异步轮询。
 *   Configuration          ：配置对象，装 API Key（也可配超时 / baseURL / 代理）
 *   MultiModalConversation ：多模态生成客户端，call() 即请求 multimodal-generation
 *   VideoSynthesis         ：视频生成客户端，call() 内部封装「提交任务 + 轮询到完成」
 *   易错点：业务失败不抛异常，返回值要看 status_code / code / task_status 判断
 *   提醒：网上旧教程里的 from 'dashscope' 是同一仓库较早的包名，不要混装
 *
 * 与文生图的差别：
 *   文生图只给 { text }；图像编辑要在同一条 message 里「既给指令文本、又给原图」，
 *   模型据此在保留原图主体的前提下修改画面。
 *   enable_interleave 是这张模型的「模式开关」：
 *     false → 图像编辑（本脚本用法）
 *     true  → 图文混排生成（一次产出文字 + 多张图的组合）
 *
 * 运行：node src/wan/image-edit.mjs
 * 前置：.env 中 OPENAI_API_KEY = DashScope 的 API Key
 * 输出：output-wan-image-edit.png（脚本自动下载到项目根目录）
 * =====================================================================
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
// Configuration 负责装凭证；MultiModalConversation 打原生多模态生成接口
import { Configuration, MultiModalConversation } from 'dashscope-sdk-official';

// 待编辑的原图（公网可访问；OSS 上的图片需保证 URL 可读或带签名）
const imageUrl = 'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg';

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
// 万相图像编辑走 DashScope 原生 multimodal-generation，不能用 ChatOpenAI
const client = new MultiModalConversation(configuration);

const result = await client.call({
  model: 'wan2.6-image',
  // 编辑任务：同一条 message 里同时传 { text } 指令和 { image } 原图 URL
  messages: [
    {
      role: 'user',
      content: [
        { text: '把图片背景改成下雪的冬天，人物保持不变' },
        { image: imageUrl },
      ],
    },
  ],
  prompt_extend: true, // 是否自动扩写提示词（让改写指令更丰满）
  watermark: false, // 是否添加「AI 生成」水印
  n: 1, // 生成张数
  enable_interleave: false, // false = 图像编辑；true = 图文混排生成
  size: '1K', // 输出分辨率档位（编辑场景用档位即可，不必写 宽*高）
});

// 原生 SDK 的业务错误不抛异常，需手动检查
if (result.status_code !== 200 || result.code) {
  throw new Error(result.message ?? `Request failed: ${result.status_code}`);
}

// 编辑后的图片同样通过 output.choices[0].message.content[0].image 返回
const resultUrl = result.output?.choices?.[0]?.message?.content?.[0]?.image;
if (!resultUrl) {
  throw new Error(`No image URL in response: ${JSON.stringify(result)}`);
}

console.log('model: wan2.6-image');
console.log('edited image URL:', resultUrl);

// 结果 URL 有效期有限，落地保存
const imageResponse = await fetch(resultUrl);
writeFileSync('output-wan-image-edit.png', Buffer.from(await imageResponse.arrayBuffer()));
console.log('Saved to output-wan-image-edit.png');
