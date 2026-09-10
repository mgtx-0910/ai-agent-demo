/**
 * 视频理解 — qwen3.5-omni-flash（全模态理解模型）
 * =====================================================================
 * 技术路线：DashScope「OpenAI 兼容模式」+ LangChain 的 ChatOpenAI
 *
 * 运行：node src/video-understanding.mjs
 * 前置：.env 中 OPENAI_API_KEY / OPENAI_BASE_URL（同图像理解）
 * 输出：视频内容的总结（打印到控制台）
 *
 * 消息结构要点：
 *   视频元素为 { type: 'video_url', video_url: { url } }。
 *   注意：视频理解耗时明显高于图片/音频，且对视频时长、分辨率有限制，
 *   长视频建议先切片或抽帧，再交给模型。
 * =====================================================================
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';

const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'qwen3.5-omni-flash', // 全模态模型，支持直接「看」视频
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL, // DashScope 兼容模式地址
  },
});

const response = await model.invoke([
  new HumanMessage({
    content: [
      { type: 'text', text: '总结这个视频的主要内容' },
      {
        type: 'video_url',
        video_url: {
          // 公网可访问的视频地址；本地视频需先上传到可被访问的位置（或转 base64）
          url: 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241115/cqqkru/1.mp4',
        },
      },
    ],
  }),
]);

console.log('model: qwen3.5-omni-flash');
console.log(response.content);
