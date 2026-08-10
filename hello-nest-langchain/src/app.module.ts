import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BookModule } from './book/book.module';
import { AiModule } from './ai/ai.module';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

/**
 * AppModule — NestJS 应用的根模块（Root Module）
 *
 * 在 NestJS 中，"模块（Module）"是用来组织代码的基本单元。
 * 每个 Nest 应用至少有一个根模块，作为 DI 容器的入口。
 *
 * @Module 装饰器的参数解释：
 * - imports：   导入其他模块，让当前模块可以使用它们导出的 provider
 * - controllers：注册控制器，负责处理 HTTP 请求
 * - providers：  注册服务/提供者，会被注入到 DI 容器中，
 *                同一模块内的 controller 和 provider 可以互相注入
 */
@Module({
  imports: [
    // ========== ServeStaticModule ==========
    // 用于托管前端静态文件（HTML / CSS / JS）
    // 配置后，访问 http://localhost:3000 会直接返回 public/ 下的 index.html
    // forRoot() 是 NestJS 中"动态模块"的约定方法，用于接受配置参数
    ServeStaticModule.forRoot({
      // join 拼接路径：编译后的 dist/public 目录
      rootPath: join(__dirname, '..', 'public'),
    }),

    // ========== 业务模块 ==========
    // 导入 Book 和 AI 两个子模块，它们的 controller/service 会注册到应用中
    BookModule,
    AiModule,

    // ========== ConfigModule ==========
    // @nestjs/config 用于读取 .env 环境变量文件
    // isGlobal: true 表示全局可用，其他模块无需再次 import 就能注入 ConfigService
    ConfigModule.forRoot({
      isGlobal: true, // 全局模块，其他模块可直接注入 ConfigService
      envFilePath: '.env', // 指定环境变量文件路径
    }),
  ],

  // ========== 根模块的 Controller ==========
  // 处理 "/" 根路径请求
  controllers: [AppController],

  // ========== 根模块的 Provider ==========
  // AppService 实例会被 Nest 的 DI 容器管理，可注入到 AppController 中
  providers: [AppService],
})
export class AppModule {}
