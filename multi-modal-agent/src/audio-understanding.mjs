/**
 * 音频理解 — qwen3.5-omni-flash（全模态理解模型）
 * =====================================================================
 * 技术路线：DashScope「OpenAI 兼容模式」+ LangChain 的 ChatOpenAI
 *
 * 运行：node src/audio-understanding.mjs
 * 前置：.env 中 OPENAI_API_KEY / OPENAI_BASE_URL（同图像理解）
 * 输出：音频内容的转写/理解结果（打印到控制台）
 *
 * 消息结构要点：
 *   音频元素为 { type: 'input_audio', input_audio: { data, format } }。
 *   这里 data 直接给的公网 URL（DashScope 兼容模式支持）；
 *   按 OpenAI 官方规范应传 base64 字符串，此时 format 必须与真实格式一致（wav/mp3…）。
 * =====================================================================
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';

// 同一套 ChatOpenAI 客户端，只换 model 名即可切换「能处理音频的全模态模型」
const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'qwen3.5-omni-flash', // omni（全模态）系列：文本 / 图像 / 音频 / 视频通吃
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL, // DashScope 兼容模式地址
  },
});

const response = await model.invoke([
  new HumanMessage({
    // 仍是「数组型 content」，这次装的是「文本 + 音频」
    content: [
      { type: 'text', text: '这段音频里说了什么？' },
      {
        type: 'input_audio',
        input_audio: {
          // 音频地址：兼容模式允许直接给 URL；给 base64 时格式需与 format 字段匹配
          data: 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250211/tixcef/cherry.wav',
          format: 'wav', // 音频容器格式，传给模型做解码用
        },
      },
    ],
  }),
]);

console.log('model: qwen3.5-omni-flash');
console.log(response.content);
