import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../interfaces/api-response.interface';

/**
 * 自定义参数装饰器：@CurrentUser()
 *
 * 作用：把"从 request 上取登录用户"这件重复的事封装起来。
 * 用法：在 Controller 方法参数里
 *     findOne(@CurrentUser() user: JwtPayload) { ... }
 * Nest 在调用方法前执行这里的工厂函数，返回值直接注入参数 user。
 *
 * 数据来源：AuthGuard.canActivate 校验通过后写入的 request.user。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return request.user;
  },
);
