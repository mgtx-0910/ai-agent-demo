import { Controller, Get, MessageEvent, Query, Sse } from '@nestjs/common';
import { AiService } from './ai.service';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * AiController — AI 对话控制器
 *
 * 路由前缀：/ai
 * 提供两个端点：
 * - GET /ai/chat          普通 JSON 响应（一次性返回结果）
 * - SSE /ai/chat/stream   服务器推送事件流式响应（逐字推送）
 */
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * GET /ai/chat?query=xxx
   *
   * 普通对话接口：等待 AI 完成全部推理后，一次性返回 { answer } JSON
   *
   * @param query 用户提问的文本
   */
  @Get('chat')
  async chat(@Query('query') query: string) {
    const answer = await this.aiService.runChain(query);
    return { answer };
  }

  /**
   * SSE /ai/chat/stream?query=xxx
   *
   * 流式对话接口：使用 Server-Sent Events 将 AI 生成的内容逐块推送给前端
   * 前端通过 EventSource 或 fetch + ReadableStream 接收实时文本流
   *
   * @param query 用户提问的文本
   */
  @Sse('chat/stream')
  chatStream(@Query('query') query: string): Observable<MessageEvent> {
    const stream = this.aiService.runChainStream(query);

    return from(stream).pipe(
      map((chunk) => ({
        data: chunk,
      })),
    );
  }
}
