import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * bootstrap 是 NestJS 应用的启动函数
 * 
 * 执行流程：
 * 1. NestFactory.create(AppModule) — 根据根模块创建 Nest 应用实例
 *    Nest 会扫描 AppModule 中声明的所有 controller 和 provider，
 *    自动完成依赖注入（DI）容器的初始化
 * 2. app.listen(port)  — 启动 HTTP 服务器，监听指定端口
 * 3. 端口取值：优先使用环境变量 PORT，否则默认 3000
 *    process.env.PORT ?? 3000 中的 ?? 是"空值合并运算符"，
 *    只在 PORT 为 null 或 undefined 时才用 3000
 */
async function bootstrap() {
  // NestFactory 是 NestJS 的核心工厂类，用于创建应用实例
  const app = await NestFactory.create(AppModule);

  // 启动 HTTP 服务，监听在 .env 中的 PORT 或默认 3000 端口
  await app.listen(process.env.PORT ?? 3000);
}

// 调用启动函数，整个应用从这里开始运行
bootstrap();
