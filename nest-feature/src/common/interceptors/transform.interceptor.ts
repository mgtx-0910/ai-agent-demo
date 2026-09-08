import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map, tap } from 'rxjs';
import { ApiResponse } from '../interfaces/api-response.interface';

/**
 * TransformInterceptor：全局响应拦截器（成功路径的"统一外壳"）
 *
 * 职责：
 *  1. 在请求进来时打印一行 [请求] 日志；
 *  2. 等业务处理完成，把返回值包成 { code: 200, data, message: '成功' }；
 *  3. 响应发出前打印 [响应] 日志（含耗时）。
 *
 * 与 AllExceptionsFilter 配合：成功走拦截器、失败走过滤器，两边外壳一致。
 * 注册方式：main.ts 里 app.useGlobalInterceptors(new TransformInterceptor())
 *
 * 泛型说明：intercept<T, ApiResponse<T>> 表示"进来 T，出去包成 ApiResponse<T>"
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
    }>();
    const { method, url } = request;
    const startTime = Date.now();
    const requestTime = new Date().toISOString();

    // 请求到达日志
    console.log(`[请求] ${requestTime} ${method} ${url}`);

    // next.handle() 触发真正的 Controller 处理；处理完的返回值在流里继续加工
    return next.handle().pipe(
      // map：把业务返回值 data 包成统一成功结构
      map((data) => ({
        code: 200,
        data,
        message: '成功',
      })),
      // tap：不影响数据流，只在响应发出前记录耗时（副作用日志）
      tap(() => {
        const duration = Date.now() - startTime;
        console.log(
          `[响应] ${new Date().toISOString()} ${method} ${url} 耗时 ${duration}ms`,
        );
      }),
    );
  }
}
