/**
 * 语音模块
 *
 * 核心概念：
 * - 注入 ASR_CLIENT（腾讯云一句话识别客户端）
 * - 提供 SpeechService（识别）与 TtsRelayService（合成中继）
 * - 导出 TtsRelayService 供 main.ts 在启动时获取
 *
 * @see speech/speech.service.ts — 一句话语音识别
 * @see speech/tts-relay.service.ts — AI 文本到 TTS 音频的 WebSocket 中继
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpeechService } from './speech.service';
import { SpeechController } from './speech.controller';
import { TtsRelayService } from './tts-relay.service';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';

const AsrClient = tencentcloud.asr.v20190614.Client; // 腾讯云 ASR 客户端类

@Module({
  providers: [
    SpeechService,
    TtsRelayService,
    {
      provide: 'ASR_CLIENT', // 注入令牌：一句话识别客户端
      useFactory: (configService: ConfigService) => {
        return new AsrClient({
          credential: {
            secretId: configService.get<string>('SECRET_ID'), // API 密钥 ID
            secretKey: configService.get<string>('SECRET_KEY'), // API 密钥 Key
          },
          region: 'ap-shanghai', // 服务区域
          profile: {
            httpProfile: {
              reqMethod: 'POST', // 请求方式
              reqTimeout: 30, // 请求超时时间（秒）
            },
          },
        });
      },
      inject: [ConfigService],
    },
  ],
  controllers: [SpeechController],
  exports: [TtsRelayService], // 导出供根模块/启动入口使用
})
export class SpeechModule {}
