/**
 * AI 对话模块
 *
 * 核心概念：
 * - 通过工厂函数注入 CHAT_MODEL（ChatOpenAI 实例）
 * - 模型名、API Key、BaseURL 均从 ConfigService 读取，支持接入任意 OpenAI 兼容端点
 *
 * @see ai/ai.service.ts — 使用 CHAT_MODEL 构建 LangChain 流式链
 * @see ai/ai.controller.ts — 暴露 SSE 流式接口
 */
import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    {
      provide: 'CHAT_MODEL', // 注入令牌：聊天模型实例
      useFactory: (configService: ConfigService) => {
        return new ChatOpenAI({
          model: configService.get('MODEL_NAME'), // 模型名（如 gpt-4o-mini）
          apiKey: configService.get('OPENAI_API_KEY'), // 模型 API 密钥
          configuration: {
            baseURL: configService.get('OPENAI_BASE_URL'), // OpenAI 兼容端点地址
          },
        });
      },
      inject: [ConfigService],
    },
  ],
})
export class AiModule {}
