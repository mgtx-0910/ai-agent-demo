import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { UserService } from './user.service';
import { UsersModule } from '../users/users.module';
import { ToolModule } from '../tool/tool.module';

/**
 * AiModule — AI 对话模块
 *
 * 导入 UsersModule（数据库用户 CRUD）和 ToolModule（所有 LangChain 工具），
 * 注册 AiService、UserService（内存版），以及 QUERY_USER_TOOL（内联工具）。
 *
 * QUERY_USER_TOOL 是一个通过工厂函数创建的自定义 Provider，
 * 封装了通过 userId 查询内存用户数据的 LangChain tool，
 * AiService 通过 @Inject('QUERY_USER_TOOL') 注入使用。
 *
 * NestJS IoC 说明：
 * - providers 数组将类/值/工厂注册到 NestJS IoC 容器，容器管理其生命周期（默认单例）
 * - 简写 `providers: [AiService]` 等价于 `{ provide: AiService, useClass: AiService }`，
 *   provide 为注入令牌（token），其他类通过 constructor(private ai: AiService) 按类型匹配
 * - 自定义 Provider（如 QUERY_USER_TOOL）用字符串 token + useFactory/inject 声明依赖链，
 *   NestJS 会先解析 inject 里的依赖，再调用 useFactory 生成实例
 */
@Module({
  imports: [UsersModule, ToolModule],
  controllers: [AiController],
  providers: [
    AiService,
    UserService,
    {
      provide: 'QUERY_USER_TOOL',
      useFactory: (userService: UserService) => {
        const queryUserArgsSchema = z.object({
          userId: z.string().describe('用户 ID，例如: 001, 002, 003'),
        });

        return tool(
          ({ userId }: { userId: string }) => {
            const user = userService.findOne(userId);

            if (!user) {
              const availableIds = userService
                .findAll()
                .map((u) => u.id)
                .join(', ');

              return `用户 ID ${userId} 不存在。可用的 ID: ${availableIds}`;
            }

            return `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}\n- 角色: ${user.role}`;
          },
          {
            name: 'query_user',
            description:
              '查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。',
            schema: queryUserArgsSchema,
          },
        );
      },
      inject: [UserService],
    },
  ],
})
export class AiModule {}
