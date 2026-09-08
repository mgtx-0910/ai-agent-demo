import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * AuthModule：模拟的认证模块
 *
 * 为什么用 @Global()？
 *  - AuthGuard、业务 Controller 等散落在各个模块中，都需要校验 Token、
 *    访问当前登录用户（依赖 AuthService）。
 *  - 标记为全局模块并 exports AuthService 后，其他任何模块无需 import
 *    AuthModule，也能直接注入 AuthService。
 *
 * 注意：本示例用静态 Token 映射表"模拟"认证，真实项目应替换为 JWT + 数据库校验。
 */
@Global()
@Module({
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
