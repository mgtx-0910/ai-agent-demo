/* eslint-disable @typescript-eslint/no-unsafe-call -- @nestjs/swagger 装饰器类型限制，标准 NestJS Controller 写法 */

import { Controller, Get, MessageEvent, Query, Sse } from '@nestjs/common';
import { AiService } from './ai.service';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

/**
 * AiController — AI 对话控制器
 *
 * 路由前缀：/ai
 * 提供两个端点：
 * - GET /ai/chat          普通 JSON 响应（一次性返回结果）
 * - SSE /ai/chat/stream   服务器推送事件流式响应（逐字推送）
 *
 * NestJS IoC 说明：
 * - constructor(private aiService: AiService) 是构造器注入的标准写法
 * - NestJS 根据参数类型 AiService 去 IoC 容器中查找 { provide: AiService, useClass: AiService }
 *   即 ai.module.ts 的 providers: [AiService] 注册的那个单例
 * - AiService 自身也必须用 @Injectable() 标记，否则容器无法解析其构造函数参数
 */
@ApiTags('AI')
@Controller('ai')
export class AiController {
  // 构造器注入：NestJS 按类型从 IoC 容器中取出 AiService 单例并传入
  constructor(private readonly aiService: AiService) {}

  /**
   * GET /ai/chat?query=xxx
   *
   * 普通对话接口：等待 AI 完成全部推理后，一次性返回 { answer } JSON
   *
   * @param query 用户提问的文本
   */
  @ApiOperation({
    summary: 'AI 对话',
    description: '发送问题给 AI，一次性返回完整回答',
  })
  @ApiQuery({
    name: 'query',
    required: true,
    description: '用户提问的文本',
    type: String,
  })
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
  @ApiOperation({
    summary: 'AI 流式对话',
    description: '发送问题给 AI，通过 SSE 流式返回回答',
  })
  @ApiQuery({
    name: 'query',
    required: true,
    description: '用户提问的文本',
    type: String,
  })
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
