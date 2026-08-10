import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

/**
 * UsersModule — 用户模块
 *
 * 注册 UsersController（REST API）和 UsersService（TypeORM 数据库操作），
 * 并导出 UsersService 供其他模块（如 ToolModule）注入使用。
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
