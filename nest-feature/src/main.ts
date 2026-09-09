import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

/**
 * 应用启动入口（bootstrap：引导/启动）
 *
 * Nest 启动流程：
 *  1. NestFactory.create(AppModule) —— 解析根模块，递归加载所有被 import 的模块与依赖
 *  2. app.useGlobalXxx(...) —— 注册全局级基础设施（这里注册了异常过滤器 + 响应拦截器）
 *  3. app.listen(port) —— 启动 HTTP 服务
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局异常过滤器：所有抛出的异常统一在这里转成 { code, data, message } 结构返回
  app.useGlobalFilters(new AllExceptionsFilter());

  // 全局响应拦截器：所有成功响应统一包裹成 { code: 200, data, message: '成功' }
  app.useGlobalInterceptors(new TransformInterceptor());

  // 监听端口：支持环境变量 PORT 覆盖，默认 3001（3000 被 mem0 dashboard 容器占用）
  await app.listen(process.env.PORT ?? 3001);
  console.log(`应用已启动: http://localhost:${process.env.PORT ?? 3001}`);
}
bootstrap();
