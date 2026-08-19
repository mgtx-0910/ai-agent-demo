import { BadRequestException, Body, Controller, Get, Post, Query, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { AiService } from './ai.service';
import { pipeUIMessageStreamToResponse, UIMessage } from 'ai';

/**
 * AI 对话控制器。
 * 路由前缀 /ai，提供流式对话接口（SSE）。
 * 请求体遵循 Vercel AI SDK 的 UIMessage 结构，前端可直接复用 useChat 等工具。
 */
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * 流式对话：POST /ai/chat
   *
   * 本地测试：
   * curl -N -sS -X POST 'http://localhost:3000/ai/chat' \
   *   -H 'Content-Type: application/json' \
   *   -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"北京今天的天气"}]}]}'
   *
   * 入参：{ messages: UIMessage[] }——历史消息数组（含用户/助手消息），用于多轮上下文。
   * 出参：SSE 流，通过 pipeUIMessageStreamToResponse 将 AI SDK 流式数据直接写到响应。
   */
  @Post('chat')
  async postChat(
    @Body() body: { messages?: UIMessage[] },
    // passthrough: false 表示本接口自行接管响应对象（不走 Nest 默认返回值序列化）
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    // 参数校验：messages 必须是非空数组，否则返回 400
    if (!body?.messages || !Array.isArray(body.messages)) {
      throw new BadRequestException('Invalid JSON');
    }

    // 触发 AI agent 流式生成，并管道化到 HTTP 响应（SSE）
    const stream = await this.aiService.stream(body.messages);
    pipeUIMessageStreamToResponse({ response: res, stream });
  }
}
