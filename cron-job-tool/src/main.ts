import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * bootstrap 是 NestJS 应用的启动函数
 *
 * NestFactory.create() 接收根模块 AppModule，
 * 根据模块中注册的控制器/服务/导入模块构建完整的依赖注入容器。
 *
 * app.listen(PORT) 启动 HTTP 服务，监听在 .env 中的 PORT 或默认 3000 端口。
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}

// 调用启动函数，整个应用从这里开始运行
void bootstrap();
