import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiResponse } from '../interfaces/api-response.interface';

/**
 * AllExceptionsFilter：全局异常过滤器
 *
 * 职责：请求生命周期里任何一步抛出的异常，最终都会走到这里，
 * 统一格式化成 { code, data, message } 后写回 HTTP 响应 ——
 * 这样前端拿到的失败响应与拦截器包出来的成功响应结构完全一致。
 *
 * 注册方式：main.ts 里 app.useGlobalFilters(new AllExceptionsFilter())
 * 捕获范围：@Catch() 不写类型 = 捕获所有异常（含非 HttpException 的兜底）
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // 默认值：未知异常 → 500
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      // Nest 已知异常（BadRequest/Unauthorized/NotFound 等）：取状态码与内置消息
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // getResponse() 可能是纯字符串，也可能是 { message, ... } 对象
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        // class-validator 等会把 message 变成数组（多条校验错误），这里拍平拼接
        const rawMessage = (exceptionResponse as { message: string | string[] })
          .message;
        message = Array.isArray(rawMessage)
          ? rawMessage.join(', ')
          : rawMessage;
      }
    } else if (exception instanceof Error) {
      // 非 HttpException：记录日志（演示只打 message，真实项目应打完整堆栈）
      console.error('[未捕获异常]', exception.message);
    }

    const body: ApiResponse<null> = {
      code: status,
      data: null,
      message,
    };

    response.status(status).json(body);
  }
}
