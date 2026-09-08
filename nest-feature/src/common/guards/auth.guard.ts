import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { JwtPayload } from '../interfaces/api-response.interface';

/**
 * AuthGuard：请求生命周期中的"守门员"（鉴权 + 授权）
 *
 * 执行时机：在路由处理方法被调用之前。return false / 抛异常都会拦截请求。
 * 注册方式：@UseGuards(AuthGuard) 局部使用（见 user.controller.ts）
 *
 * 职责分两层：
 *  1. 鉴权（Authentication）——有没有登录：解析 Authorization 头 → 校验 Token
 *  2. 授权（Authorization）——有没有权限：带 :id 的路由，普通用户只能操作自己
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  /**
   * 返回值 true 放行 / 抛异常拦截
   * 校验通过后把用户信息挂到 request.user，供 @CurrentUser() 装饰器取用
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      params: { id?: string };
      user?: JwtPayload;
    }>();

    // 第一步：鉴权 —— 必须携带合法 Token
    const token = this.extractToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('请先登录，携带合法 Token');
    }

    const user = this.authService.validateToken(token);
    if (!user) {
      throw new UnauthorizedException('Token 无效或已过期');
    }

    request.user = user;

    // 第二步：授权 —— 路由带 :id 时，普通用户不能操作他人资源
    const targetId = request.params.id;
    if (targetId !== undefined) {
      const id = Number.parseInt(targetId, 10);
      if (user.role !== 'admin' && user.id !== id) {
        throw new ForbiddenException('无权访问其他用户信息');
      }
    }

    return true;
  }

  /** 从 "Bearer <token>" 请求头中提取出 token 部分 */
  private extractToken(authorization?: string): string | null {
    if (!authorization) {
      return null;
    }

    // 按空格拆成 ["Bearer", "<token>"]，格式不符返回 null
    const [type, token] = authorization.split(' ');
    if (type !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }
}
