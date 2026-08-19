import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * 应用启动入口。
 * 创建 Nest 应用实例、开启跨域（CORS）后监听端口。
 * 端口优先取环境变量 PORT，未配置时默认 3000。
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 允许任意来源跨域访问，并允许携带凭证（Cookie/Authorization 头）。
  // 注意：origin 为 * 且 credentials 为 true 的组合，在携带凭证时浏览器会忽略通配符，
  // 实际场景如有限定前端域名，建议改为具体的 origin 列表。
  app.enableCors({
    origin: '*',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
