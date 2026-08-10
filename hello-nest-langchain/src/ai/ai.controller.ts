import { Controller, Get, Query, Sse } from '@nestjs/common';
import { from, map, Observable } from 'rxjs';
import { AiService } from './ai.service';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

/**
 * AiController — AI 对话控制器
 *
 * 路由前缀：@Controller('ai') → 所有方法路径以 /ai 开头
 *
 * 本控制器展示了两种对话模式：
 * 1. 普通请求   — GET /ai/chat?query=你好
 * 2. 流式响应   — GET /ai/chat/stream?query=你好  (Server-Sent Events)
 *
 * 装饰器速查：
 * - @Get('path')     → 映射 GET 请求
 * - @Query('query')  → 提取 URL 查询参数，如 ?query=你好
 * - @Sse('path')     → 声明 SSE（Server-Sent Events）端点
 */
@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * ========== 普通对话接口 ==========
   *
   * GET /ai/chat?query=你好
   *
   * 特点：
   * - 等待 AI 完整生成后再一次性返回
   * - 适合简短回答或不需要实时反馈的场景
   * - 返回 JSON: { answer: "AI 的回复" }
   */
  @ApiOperation({ summary: 'AI 对话', description: '发送问题给 AI，一次性返回完整回答' })
  @ApiQuery({ name: 'query', required: true, description: '用户提问的文本', type: String })
  @Get('chat')
  async chat(@Query('query') query: string) {
    // query 参数从 URL 的 ?query=xxx 中提取
    // 例如：/ai/chat?query=今天天气怎么样 → query = "今天天气怎么样"
    const answer = await this.aiService.runChain(query);
    // Nest 自动将对象序列化为 JSON
    return { answer };
  }

  /**
   * ========== 流式对话接口（SSE）==========
   *
   * GET /ai/chat/stream?query=你好
   *
   * SSE（Server-Sent Events）是一种服务器推送技术：
   * - 连接建立后，服务器可以持续推送数据到客户端
   * - 客户端不需要轮询，数据自动流过来
   * - 类似 ChatGPT / Claude 打字机效果
   *
   * 技术实现：
   * 1. aiService.streamChain() 返回 AsyncGenerator，逐块产出 AI 文本
   * 2. from() 将 AsyncGenerator 包装成 RxJS Observable 流
   * 3. map() 将每个 chunk 格式化为 { data: chunk }，满足 SSE 协议格式
   * 4. @Sse 装饰器告诉 Nest：这是一个 SSE 端点，自动设置响应头
   *
   * RxJS 关键概念：
   * - Observable：可观察对象，表示"未来会推送数据"的流
   * - from()：把 AsyncGenerator/Promise/数组 转为 Observable
   * - pipe(map(...))：对流中的每个数据进行转换
   */
  @ApiOperation({ summary: 'AI 流式对话', description: '发送问题给 AI，通过 SSE 流式返回回答' })
  @ApiQuery({ name: 'query', required: true, description: '用户提问的文本', type: String })
  @Sse('chat/stream')
  chatStream(@Query('query') query: string): Observable<{ data: string }> {
    // 调用 service 的流式方法，返回 AsyncGenerator<string>
    // from() 将其转为 Observable，每当 generator yield 新数据时触发
    return from(this.aiService.streamChain(query)).pipe(
      // SSE 协议要求数据格式为 { data: string }
      // 每个 AI 生成的文本 chunk 被包装成 { data: chunk }
      map((chunk) => ({ data: chunk })),
    );
  }
}
