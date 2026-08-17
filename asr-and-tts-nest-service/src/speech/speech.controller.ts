/**
 * 语音识别控制器
 *
 * 核心概念：
 * - 提供 POST /speech/asr 接口，接收 FormData 上传的音频文件
 * - 使用 FileInterceptor 解析 multipart 中的 audio 字段为内存 Buffer
 * - 校验后委托 SpeechService 完成一句话识别
 *
 * 数据流向：客户端上传音频 → FileInterceptor → SpeechService.recognizeBySentence → 识别文本
 *
 * @see speech/speech.service.ts — 封装腾讯云一句话识别
 */
import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SpeechService } from './speech.service';

@Controller('speech')
export class SpeechController {
  constructor(private readonly speechService: SpeechService) {} // 注入识别服务

  @Post('asr')
  @UseInterceptors(FileInterceptor('audio')) // 解析 multipart 表单的 audio 字段
  async recognize(
    @UploadedFile()
    file?: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
  ) {
    if (!file?.buffer?.length) { // 校验上传文件非空
      throw new BadRequestException(
        '请通过 FormData 的 audio 字段上传音频文件',
      );
    }

    const text = await this.speechService.recognizeBySentence(file); // 调用一句话识别
    return { text };
  }
}
