/**
 * 图像理解 — qwen-vl-plus（视觉理解模型）
 * =====================================================================
 * 技术路线：DashScope「OpenAI 兼容模式」+ LangChain 的 ChatOpenAI
 *   兼容模式地址：https://dashscope.aliyuncs.com/compatible-mode/v1
 *   价值：复用 OpenAI 生态的写法（ChatOpenAI / HumanMessage），只改 baseURL，
 *         不用学一套新 SDK；换成真·OpenAI 时删掉 baseURL 即可。
 *
 * 运行：node src/image-understanding.mjs
 * 前置：.env 中 OPENAI_API_KEY = DashScope 的 API Key，OPENAI_BASE_URL = 上面那个地址
 * 输出：模型对图片的自然语言描述（打印到控制台）
 *
 * 消息结构要点：
 *   content 是一个「数组」，把「文字 + 图片」拼在同一条 HumanMessage 里；
 *   图片元素为 { type: 'image_url', image_url: { url } }。
 *   这里传的是公网 URL；本地图片要写成 data:image/png;base64,xxx 的内联形式。
 * =====================================================================
 */
import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';

// ChatOpenAI 本质是「OpenAI 协议的客户端」，把 baseURL 指向 DashScope 即可调通义千问
const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'qwen-vl-plus', // 视觉理解模型；需要更强能力可换 qwen-vl-max 等
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL, // 关键：不是 api.openai.com，而是兼容模式地址
  },
});

// invoke 一次 = 一轮对话；此处无历史消息，等价于「单轮提问」
const response = await model.invoke([
  new HumanMessage({
    // 多模态消息：content 为数组，元素按顺序排列「文本 + 图片」
    content: [
      { type: 'text', text: '详细描述这张图片的内容' },
      {
        type: 'image_url',
        image_url: {
          // 公网可访问的图片地址；本地图片需转成 base64 的 data URL 才能传
          url: 'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg',
        },
      },
    ],
  }),
]);

console.log('model: qwen-vl-plus');
// 兼容模式的返回值与 OpenAI 一致：response.content 就是模型输出的纯文本
console.log(response.content);
