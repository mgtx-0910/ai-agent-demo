import { Module } from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard';
import { UserController } from './user.controller';
import { UserService } from './user.service';

/**
 * 用户模块：一个标准的"分层 CRUD + Nest 特性演示"模块
 *
 * - controllers：接收 HTTP 请求，把参数交给 Service
 * - providers：
 *   - UserService：业务逻辑（内存数据）
 *   - AuthGuard：手动声明注入。它依赖全局 AuthModule 导出的 AuthService，
 *     Nest 会把它作为可注入 Provider 解析（@Injectable 内部带构造函数依赖）
 */
@Module({
  controllers: [UserController],
  providers: [UserService, AuthGuard],
})
export class UserModule {}
