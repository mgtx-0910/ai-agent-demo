/**
 * 语音识别服务
 *
 * 核心概念：
 * - 封装腾讯云一句话识别（SentenceRecognition）接口
 * - 将上传的音频 Buffer 转为 Base64 提交，返回识别文本
 *
 * 数据流向：音频 Buffer → Base64 → SentenceRecognition → 识别文本
 *
 * @see speech/speech.controller.ts — 上传音频并调用本服务的控制器
 */
import { Inject, Injectable } from '@nestjs/common';
import type * as tencentcloud from 'tencentcloud-sdk-nodejs';

type UploadedAudio = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

type AsrClient = InstanceType<typeof tencentcloud.asr.v20190614.Client>; // ASR 客户端类型

@Injectable()
export class SpeechService {
  constructor(@Inject('ASR_CLIENT') private readonly asrClient: AsrClient) {} // 注入 ASR 客户端

  async recognizeBySentence(file: UploadedAudio): Promise<string> {
    const audioBase64 = file.buffer.toString('base64'); // 音频 Buffer 转为 Base64

    const result = await this.asrClient.SentenceRecognition({
      EngSerViceType: '16k_zh', // 引擎模型类型：16k 采样率中文
      SourceType: 1, // 音频数据来源：1 = 音频数据直接作为请求参数
      Data: audioBase64, // Base64 编码的音频数据
      DataLen: file.buffer.length, // 音频数据的字节长度
      VoiceFormat: 'ogg-opus', // 音频编码格式
    });

    return result.Result ?? '';
  }
}
