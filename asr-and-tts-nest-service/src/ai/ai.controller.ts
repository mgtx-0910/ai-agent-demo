/**
 * AI 对话控制器
 *
 * 核心概念：
 * - 提供 SSE 接口 GET /ai/chat/stream，以流式方式返回 AI 回答
 * - 可选携带 ttsSessionId，触发 TTS 联动：先发 start 事件，再由 AiService 逐分片发 chunk/end
 *
 * 数据流向：客户端 SSE 请求 → AiService.streamChain → 文本分片 + 事件总线 → 客户端
 *
 * @see ai/ai.service.ts — 提供 LangChain 流式链
 * @see common/stream-events.ts — 事件类型定义
 * @see speech/tts-relay.service.ts — 消费事件并合成语音
 */
import { Controller, Get, Query, Sse } from '@nestjs/common';
import { from, map, Observable } from 'rxjs';
import { AiService } from './ai.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AI_TTS_STREAM_EVENT, type AiTtsStreamEvent } from '../common/stream-events';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService, // AI 流式链服务
    private readonly eventEmitter: EventEmitter2, // 事件总线，用于 TTS 联动
  ) {}

  @Sse('chat/stream')
  chatStream(
    @Query('query') query: string, // 用户问题
    @Query('ttsSessionId') ttsSessionId?: string, // 可选：TTS 会话 ID，触发语音合成联动
  ): Observable<{ data: string }> {
    const sessionId = ttsSessionId?.trim();
    if (sessionId) {
      const startEvent: AiTtsStreamEvent = { type: 'start', sessionId, query };
      this.eventEmitter.emit(AI_TTS_STREAM_EVENT, startEvent); // 通知 TTS 开始
    }

    return from(this.aiService.streamChain(query, sessionId)).pipe(
      map((chunk) => ({ data: chunk })), // 将文本分片包装为 SSE data
    );
  }
}
