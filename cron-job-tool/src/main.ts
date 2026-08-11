import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * bootstrap 是 NestJS 应用的启动函数
 *
 * NestFactory.create() 接收根模块 AppModule，
 * 根据模块中注册的控制器/服务/导入模块构建完整的依赖注入容器。
 *
 * app.listen(PORT) 启动 HTTP 服务，监听在 .env 中的 PORT 或默认 3000 端口。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 关于「中间件（Middleware）」—— 本项目目前没有写任何中间件
 * ─────────────────────────────────────────────────────────────────────
 * 中间件是：在「请求到达你的控制器方法之前」自动执行的一段函数，可以读写请求/响应，
 * 常用于：日志记录、鉴权(验证 token)、跨域(CORS)、压缩、限流等「所有请求都要做」的事。
 * 它的位置在 HTTP 流水线里，排在路由（@Get/@Post 等）之前。
 *
 * 在 NestJS 里注册中间件有两种方式：
 *   1) 全局：在本文件里写 app.use(someMiddlewareFn)  // 对所有请求生效
 *   2) 路由级：建一个实现 NestMiddleware 的类，在模块的 configure() 里
 *      consumer.apply(MyMiddleware).forRoutes('ai')  // 只对 /ai 生效
 *
 * 本项目现在没用到中间件，所以 main.ts 里只有 NestFactory.create + listen。
 * 以后想加「全局前置逻辑」(比如打印每个请求的 URL)，就在 app.listen 之前加
 * app.use(...) 即可。
 * ─────────────────────────────────────────────────────────────────────
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}

// 调用启动函数，整个应用从这里开始运行
void bootstrap();
