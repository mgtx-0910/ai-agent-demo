import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtTestService } from './jwt-test.service';
import type { JwtTestPayload } from './jwt-test.service';

/**
 * jwt-test 控制器：演示真正的 JWT（@nestjs/jwt）签发与校验流程
 *
 * 与 auth 模块的"静态 Token 映射"互为对照：
 *  - auth：预置固定 Token → 直接查表还原用户
 *  - jwt-test：任意载荷 → 签名生成 Token → 验签还原载荷
 */
@Controller('jwt-test')
export class JwtTestController {
  constructor(private readonly jwtTestService: JwtTestService) {}

  /** POST /jwt-test/sign —— 用 body 里的载荷签发 JWT，返回 { access_token } */
  @Post('sign')
  sign(@Body() payload: JwtTestPayload) {
    const accessToken = this.jwtTestService.sign(payload);
    return { access_token: accessToken };
  }

  /** GET /jwt-test/verify —— 校验 Authorization 头中的 Bearer Token */
  @Get('verify')
  verify(@Headers('authorization') authorization?: string) {
    const token = this.extractBearerToken(authorization);
    if (!token) {
      throw new UnauthorizedException('请携带 Bearer Token');
    }

    return this.jwtTestService.verify(token);
  }

  /** 从 "Bearer <token>" 请求头中提取出 token 部分 */
  private extractBearerToken(authorization?: string): string | null {
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
