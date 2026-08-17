/**
 * AI 对话服务
 *
 * 核心概念：
 * - 使用 LangChain 构建「提示词 → 模型 → 字符串解析」的流式链
 * - streamChain 为异步生成器，逐分片 yield 文本供 SSE 返回
 * - 携带 ttsSessionId 时，同步向事件总线发送 chunk/end/error，驱动 TTS 联动
 *
 * 数据流向：query → PromptTemplate → ChatOpenAI.stream → StringOutputParser → 分片 + 事件总线
 *
 * @see common/stream-events.ts — 事件类型定义
 * @see speech/tts-relay.service.ts — 消费 chunk/end/error 事件合成语音
 * @see ai/ai.controller.ts — 调用 streamChain 的 SSE 控制器
 */
import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AI_TTS_STREAM_EVENT, type AiTtsStreamEvent } from '../common/stream-events';

@Injectable()
export class AiService {
  private readonly chain: Runnable; // LangChain 流式链

  constructor(
    @Inject('CHAT_MODEL') model: ChatOpenAI, // 注入聊天模型
    private readonly eventEmitter: EventEmitter2, // 事件总线，用于 TTS 联动
  ) {
    const prompt = PromptTemplate.fromTemplate('请回答以下问题：\n\n{query}'); // 提示词模板
    // 链式组合：提示词 → 模型 → 字符串解析器
    this.chain = prompt.pipe(model).pipe(new StringOutputParser());
  }

  async *streamChain(query: string, ttsSessionId?: string): AsyncGenerator<string> {
    try {
      const stream = await this.chain.stream({ query }); // 启动流式生成
      for await (const chunk of stream) {
        if (ttsSessionId) {
          const event: AiTtsStreamEvent = {
            type: 'chunk',
            sessionId: ttsSessionId,
            chunk,
          };
          this.eventEmitter.emit(AI_TTS_STREAM_EVENT, event); // 通知 TTS 合成该分片
        }
        yield chunk; // 将分片返回给 SSE 客户端
      }
      if (ttsSessionId) {
        const endEvent: AiTtsStreamEvent = { type: 'end', sessionId: ttsSessionId };
        this.eventEmitter.emit(AI_TTS_STREAM_EVENT, endEvent); // 通知 TTS 输出结束
      }
    } catch (error) {
      if (ttsSessionId) {
        const errorEvent: AiTtsStreamEvent = {
          type: 'error',
          sessionId: ttsSessionId,
          error: error instanceof Error ? error.message : String(error),
        };
        this.eventEmitter.emit(AI_TTS_STREAM_EVENT, errorEvent); // 通知 TTS 出错
      }
      throw error;
    }
  }
}
