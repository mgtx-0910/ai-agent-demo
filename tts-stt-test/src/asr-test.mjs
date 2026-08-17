/**
 * 腾讯云一句话语音识别（ASR）测试
 *
 * 核心概念：
 * - 通过 tencentcloud-sdk-nodejs 官方 SDK 调用 SentenceRecognition 接口
 * - 将本地音频文件读取为 Base64，一次性提交给服务端识别
 * - 适用于 60 秒以内的短音频（一句话识别）
 *
 * 代码逻辑：
 * 1. 从环境变量读取腾讯云密钥 SecretId / SecretKey
 * 2. 实例化 AsrClient（区域 ap-shanghai）
 * 3. 读取本地 mp3 文件并转为 Base64
 * 4. 构造识别参数并调用 SentenceRecognition，打印识别文本
 *
 * 数据流向：本地 mp3 → Base64 → SentenceRecognition → 识别文本
 *
 * @see tts-test.mjs — 正向流程（语音合成），可先生成音频再交由本文件识别
 * @see streaming-tts-test.mjs — 流式合成方案，可生成供本文件识别的长音频
 */
import "dotenv/config";
import tencentcloud from "tencentcloud-sdk-nodejs";
import fs from "node:fs";

const SECRET_ID = process.env.SECRET_ID; // 腾讯云 API 密钥 ID（.env 中配置）
const SECRET_KEY = process.env.SECRET_KEY; // 腾讯云 API 密钥 Key（.env 中配置）

const AsrClient = tencentcloud.asr.v20190614.Client; // ASR 服务客户端类
const AUDIO_FILE = './output3.mp3'; // 待识别的本地音频文件

const client = new AsrClient({
  credential: {
    secretId: SECRET_ID, // API 密钥 ID
    secretKey: SECRET_KEY, // API 密钥 Key
  },
  region: "ap-shanghai", // 服务区域
  profile: {
    httpProfile: {
      reqMethod: "POST", // 请求方式
      reqTimeout: 30, // 请求超时时间（秒）
    },
  },
});

async function run() {
  const audioBase64 = fs.readFileSync(AUDIO_FILE).toString("base64"); // 读取音频并转为 Base64

  const params = {
    EngSerViceType: "16k_zh", // 引擎模型类型：16k 采样率中文
    SourceType: 1, // 音频数据来源：1 = 音频数据直接作为请求参数
    Data: audioBase64, // Base64 编码的音频数据
    DataLen: Buffer.byteLength(audioBase64), // 音频数据的字节长度
    VoiceFormat: "mp3", // 音频编码格式
  };

  try {
    // 数据流向：params → SentenceRecognition → 识别结果文本
    const data = await client.SentenceRecognition(params);
    console.log("识别结果：", data.Result);
  } catch (err) {
    console.error("识别失败：", err);
  }
}

run();