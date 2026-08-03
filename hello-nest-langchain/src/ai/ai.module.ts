import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

/**
 * AiModule — AI 对话功能模块
 *
 * 这个模块展示了 NestJS 中一个重要概念：自定义 Provider（Custom Provider）
 *
 * 普通的 provider 写法是简写：
 *   providers: [AiService]
 *   // 等价于 { provide: 'AiService', useClass: AiService }
 *
 * 自定义 provider 可以灵活控制"注入什么"和"怎么创建"：
 *   1. provide: 'CHAT_MODEL'  — 注入令牌（token），
 *      其他类通过 @Inject('CHAT_MODEL') 注入这个实例
 *   2. useFactory                — 工厂函数，决定如何创建实例
 *   3. inject: [ConfigService]   — 声明工厂函数的参数依赖
 *
 * 工厂函数执行流程：
 *   Nest 先实例化 ConfigService → 传给 useFactory →
 *   读取 .env 中的配置 → 创建 ChatOpenAI 实例 → 注册到 DI 容器
 */
@Module({
  controllers: [AiController],
  providers: [
    // ========== 普通 Provider（简写形式）==========
    AiService,

    // ========== 自定义 Provider（完整形式）==========
    {
      // provide: token 用于 DI 查找，可以是字符串或类
      // 这里用字符串 'CHAT_MODEL'，其他类用 @Inject('CHAT_MODEL') 获取
      provide: 'CHAT_MODEL',

      // useFactory: 工厂函数，负责创建 ChatOpenAI 实例
      // configService 由下方的 inject 声明，Nest 自动传入
      useFactory: (configService: ConfigService) => {
        // 从 .env 文件中读取配置
        return new ChatOpenAI({
          model: configService.get('MODEL_NAME'),             // 模型名称，如 gpt-4o-mini
          apiKey: configService.get('OPENAI_API_KEY'),        // API 密钥
          configuration: {
            baseURL: configService.get('OPENAI_BASE_URL'),    // API 地址（兼容 OpenAI 代理服务）
          },
        });
      },

      // inject: 声明工厂函数的依赖
      // ConfigService 由 ConfigModule 提供（isGlobal: true），无需额外导入
      inject: [ConfigService],
    },
  ],
})
export class AiModule {}
