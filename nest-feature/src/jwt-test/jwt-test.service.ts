import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** JWT 自定义载荷：签发时写入 payload，验签后原样还原 */
export interface JwtTestPayload {
  sub: number;
  username: string;
}

/**
 * jwt-test 服务：封装 JWT 的签名（sign）与验签（verify）
 *
 * JwtService 由根模块全局注册的 JwtModule 提供（secret: 'jwt-test-secret-key'），
 * 通过构造函数自动注入。
 */
@Injectable()
export class JwtTestService {
  constructor(private readonly jwtService: JwtService) {}

  /** 签发：传入载荷 → 返回签好名的 JWT 字符串 */
  sign(payload: JwtTestPayload): string {
    return this.jwtService.sign(payload);
  }

  /**
   * 验签：Token 合法则还原载荷；签名错误 / 过期会抛异常，统一转成 401
   * （@nestjs/jwt 默认会校验 expiresIn 过期时间）
   */
  verify(token: string): JwtTestPayload {
    try {
      return this.jwtService.verify<JwtTestPayload>(token);
    } catch {
      throw new UnauthorizedException('Token 无效或已过期');
    }
  }
}
