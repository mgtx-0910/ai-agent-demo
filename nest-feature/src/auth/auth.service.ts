import { Injectable } from '@nestjs/common';
import { JwtPayload } from '../common/interfaces/api-response.interface';

/**
 * AuthService：负责"根据 Token 还原用户信息"
 *
 * 这是整条认证链路的信任锚点：
 *   Guard（auth.guard.ts）→ AuthService.validateToken → 得到 JwtPayload → 挂到 request.user
 *
 * 当前为演示实现，用静态映射表模拟：真实场景应校验 JWT 签名或查数据库。
 * （仓库中 jwt-test 模块演示了真正的 JWT 签发与校验）
 */
@Injectable()
export class AuthService {
  /**
   * 模拟 Token 与用户映射，实际项目应使用 JWT + 数据库
   *
   * Record<string, JwtPayload> 是 TS 内置工具类型，等价于手写 { [key: string]: JwtPayload }，
   * 含义：这是一张"查表字典"——键（token）是动态字符串，值一律是 JwtPayload。
   * 之所以必须这么标注：validateToken(token: string) 要用请求头里的任意字符串去下标取值，
   * 对象必须声明 index signature 才合法；Record 就是声明它并保证取值类型安全的简写。
   */
  private readonly tokenMap: Record<string, JwtPayload> = {
    'admin-token-123': { id: 1, username: 'admin', role: 'admin' },
    'user-token-456': { id: 2, username: 'zhangsan', role: 'user' },
  };

  /**
   * 校验 Token
   * @param token 请求头里的 Bearer Token
   * @returns 命中返回用户信息，未命中返回 null（由 Guard 决定抛 401）
   */
  validateToken(token: string): JwtPayload | null {
    return this.tokenMap[token] ?? null;
  }
}
