import { Controller, Get, MessageEvent, Query, Sse } from '@nestjs/common';
import { AiService } from './ai.service';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

/**
 * AiController — AI 对话控制器
 *
 * ─────────────────────────────────────────────────────────────────────
 * 「路由装饰器」速查
 * ─────────────────────────────────────────────────────────────────────
 * NestJS 用「装饰器」把类和方法映射成 HTTP 接口（这比手写 router 简单很多）：
 * - @Controller('ai')    声明这是个控制器，且所有路由都带 /ai 前缀
 * - @Get('chat')         把 chat() 方法绑定到 GET /ai/chat（注意前缀 + 路径）
 * - @Sse('chat/stream')  绑定到 GET /ai/chat/stream，但用 SSE 协议返回
 *                        （服务端可源源不断推数据，不是一次返回，适合 AI 流式输出）
 * - @Query('query')      从 URL 查询参数 ?query=xxx 取值，自动注入到方法参数
 * - @ApiTags/@ApiOperation/@ApiQuery  都是 @nestjs/swagger 的注解，只用于
 *                        自动生成接口文档（/docs），不影响实际运行逻辑
 *
 * 返回值怎么变响应？方法 return 的对象 NestJS 自动序列化成 JSON；
 * @Sse 方法返回 Observable（数据流），NestJS 自动按 SSE 格式逐条推送。
 * ─────────────────────────────────────────────────────────────────────
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
   * ─────────────────────────────────────────────────────────────────────
   * 「谁在调用 next()？」— from(stream).pipe(map(...)) 完整调用链
   * ─────────────────────────────────────────────────────────────────────
   *
   * runChainStream 是 async generator（async *），调用时不会执行函数体，
   * 只返回一个 AsyncIterable 对象。必须由外部拿到迭代器并反复调 .next()，
   * generator 才会逐次推进到下一个 yield。
   *
   * 这里的三层驱动：
   *
   *   ┌─────────────────────────────────────────────────────────────────┐
   *   │ 第 1 层：NestJS @Sse() 装饰器                                    │
   *   │   → 要求返回 Observable<MessageEvent>，框架订阅这个 Observable，  │
   *   │     每次推送就向 HTTP 响应写入一行 SSE 数据发给浏览器              │
   *   └─────────────────────────┬───────────────────────────────────────┘
   *                             │ 订阅 Observable
   *                             ▼
   *   ┌─────────────────────────────────────────────────────────────────┐
   *   │ 第 2 层：RxJS from() + map()                                    │
   *   │   → from(stream) 把 AsyncIterable 包装成 Observable，内部自动    │
   *   │     调用 iterator.next() 不断拉取值；每次拿到一个 yield 的值，    │
   *   │     就作为一次 Observable 推送传给下游                           │
   *   │   → map(chunk => ({ data: chunk })) 把字符串转成 { data: "..." } │
   *   │     格式，满足 MessageEvent 接口定义                             │
   *   └─────────────────────────┬───────────────────────────────────────┘
   *                             │ subscriber.next(value)
   *                             ▼
   *   ┌─────────────────────────────────────────────────────────────────┐
   *   │ 第 3 层：runChainStream async generator（async *）               │
   *   │   → 内部 while(true) + modelWithTools.stream() + yield chunk    │
   *   │     每次 yield 返回控制权给调用方（from），等下次 .next() 再继续  │
   *   └─────────────────────────────────────────────────────────────────┘
   *
   * from() 内部的简化版实现：
   *
   *   function from<T>(iterable: AsyncIterable<T>): Observable<T> {
   *     return new Observable(subscriber => {
   *       const iterator = iterable[Symbol.asyncIterator]();
   *       async function pull() {
   *         const { done, value } = await iterator.next(); // ← 这里调 next()!
   *         if (done) subscriber.complete();
   *         else { subscriber.next(value); pull(); }
   *       }
   *       pull();
   *     });
   *   }
   *
   * 结论：你不需要手动调 next()，from() 替你做了循环拉取的脏活。
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
