/**
 * 应用根模块
 *
 * 核心概念：
 * - 装配所有业务模块，并配置全局能力：环境变量、事件总线、静态资源托管
 * - ConfigModule 加载 .env 并提供全局 ConfigService
 * - EventEmitterModule 用于 AI 流式对话与 TTS 合成之间的解耦通信
 * - ServeStaticModule 托管 public 目录下的前端页面
 *
 * 代码逻辑：
 * 1. 导入 AiModule / SpeechModule 两个业务模块
 * 2. 注册全局配置、事件总线（maxListeners 200）、静态资源
 * 3. 声明根控制器 AppController 与根服务 AppService / ControllerService
 *
 * @see ai/ai.module.ts — AI 对话模块（LangChain 流式）
 * @see speech/speech.module.ts — 语音识别与合成模块
 */
import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiModule } from './ai/ai.module';
import { ConfigModule } from '@nestjs/config';
import { ControllerService } from './controller/controller.service';
import { SpeechModule } from './speech/speech.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    AiModule, // AI 对话模块（LangChain 流式）
    ConfigModule.forRoot({
      isGlobal: true, // 全局可用，无需重复导入
      envFilePath: '.env', // 从 .env 加载环境变量
    }),
    EventEmitterModule.forRoot({
      maxListeners: 200, // 单个事件最大监听器数，防止流式场景下告警
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'), // 托管 public 目录下的前端静态资源
    }),
    SpeechModule, // 语音识别与合成模块
  ],
  controllers: [AppController], // 根控制器
  providers: [AppService, ControllerService], // 根服务与辅助服务
})
export class AppModule {}
