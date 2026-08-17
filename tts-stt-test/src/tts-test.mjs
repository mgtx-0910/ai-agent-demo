/**
 * 腾讯云一句话语音合成（TTS）测试
 *
 * 核心概念：
 * - 通过 tencentcloud-sdk-nodejs-tts 官方 SDK 调用 TextToVoice 接口
 * - 将文本一次性合成为 Base64 编码的 mp3 音频，解码后写入本地文件
 * - 通过 VoiceType 切换音色、Codec 指定输出编码格式
 *
 * 代码逻辑：
 * 1. 从环境变量读取腾讯云密钥 SecretId / SecretKey
 * 2. 实例化 TtsClient（区域 ap-beijing，端点 tts.tencentcloudapi.com）
 * 3. 构造合成参数（文本、会话 ID、音色、编码格式）
 * 4. 调用 TextToVoice，将返回的 Base64 Audio 解码并写入磁盘
 *
 * 数据流向：文本 → TextToVoice → Base64 Audio → Buffer → 本地 mp3 文件
 *
 * @see streaming-tts-test.mjs — 流式合成方案，边合成边接收，延迟更低
 * @see asr-test.mjs — 反向流程（语音识别），可将本文件产物回转为文本
 */
import "dotenv/config";
import tencentcloud from "tencentcloud-sdk-nodejs-tts";
import fs from "node:fs";

const secretId = process.env.SECRET_ID;
const secretKey = process.env.SECRET_KEY;

const TtsClient = tencentcloud.tts.v20190823.Client;

const client = new TtsClient({
  credential: {
    secretId, // API 密钥 ID
    secretKey, // API 密钥 Key
  },
  region: "ap-beijing", // 服务区域
  profile: {
    httpProfile: {
      endpoint: "tts.tencentcloudapi.com", // 接口请求端点
    },
  },
});

const params = {
  Text: "下班路上，我还在为晚霞开心。突然电话响起：系统崩了。我的心一下揪紧，冲进办公室时几乎要绝望。可当大家一起排查、重启，屏幕终于恢复正常，我长长松了口气，笑着说：还好，我们没放弃。", // 要合成的文本
  SessionId: "session-001", // 会话 ID，用于请求关联与日志追踪
  VoiceType: 502006, // 音色 ID（502 系列为精品音色，可参考腾讯云 TTS 文档替换）
  Codec: "mp3", // 指定输出格式为 mp3
};

// 数据流向：params → TextToVoice → Base64 Audio → Buffer → 本地 mp3 文件
client.TextToVoice(params).then(
  (data) => {
    // 返回的 Audio 字段是 Base64 编码的音频数据
    const audioBuffer = Buffer.from(data.Audio, "base64"); // 解码为二进制音频流
    const outputPath = "./output2.mp3"; // 输出文件路径

    fs.writeFile(outputPath, audioBuffer, (err) => {
      if (err) {
        console.error("保存文件失败：", err);
      } else {
        console.log("MP3 已保存至：", outputPath);
      }
    });
  },
  (err) => {
    console.error("合成失败：", err);
  }
);