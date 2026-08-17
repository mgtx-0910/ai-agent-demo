/**
 * AI → TTS 流式事件定义
 *
 * 核心概念：
 * - 通过 EventEmitterModule 在 AiService 与 TtsRelayService 之间传递流式文本
 * - AI 流式输出被拆分为 start / chunk / end / error 四类事件
 * - TtsRelayService 监听这些事件，将文本分片转发给腾讯云 TTS 合成
 *
 * 数据流向：AiService.streamChain → 事件总线 → TtsRelayService → 腾讯云 TTS
 *
 * @see ai/ai.service.ts — 事件的生产者（AI 流式输出）
 * @see speech/tts-relay.service.ts — 事件的消费者（TTS 中继）
 */
export const AI_TTS_STREAM_EVENT = 'ai.tts.stream'; // AI 流式输出事件名

// 事件联合类型：按阶段区分四种载荷
export type AiTtsStreamEvent =
  | { type: 'start'; sessionId: string; query: string } // 开始：携带会话 ID 与用户问题
  | { type: 'chunk'; sessionId: string; chunk: string } // 分片：AI 流式输出的文本片段
  | { type: 'end'; sessionId: string } // 结束：AI 输出完成
  | { type: 'error'; sessionId: string; error: string }; // 异常：错误信息
