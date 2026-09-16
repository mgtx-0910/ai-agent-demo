import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * 应用入口
 *
 * 启动顺序：
 *   NestFactory.create(AppModule)  加载模块树 —— Postgres / Mongo 连接在这里建立
 *   → useGlobalPipes              挂载全局校验管道
 *   → app.listen                  监听端口（此时 .env 已经被 ConfigModule 读入 process.env）
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局校验管道：所有带 DTO 的 @Body / @Query / @Param 都会先过这里，再进 Controller
  app.useGlobalPipes(
    new ValidationPipe({
      // ① 白名单：DTO 里没有声明的字段直接剔除，不进入业务方法
      whitelist: true,
      // ② 类型转换：按 DTO 声明的类型做隐式转换
      //    query 参数天然是字符串，配合 DTO 上的 @Type(() => Number) 才能把 "2" 变成 2；
      //    缺了它，@IsInt() 对 "2" 会判定失败
      transform: true,
      // ③ 严格契约：出现未声明字段直接 400，而不是静默丢弃
      //    好处是调用方把字段名写错时立刻报错，不会出现「返回 200 但字段没生效」
      forbidNonWhitelisted: true,
    }),
  );

  // PORT 默认 3000，可被 .env 覆盖。此处读的是 process.env，
  // 而 ConfigModule.forRoot() 会在模块初始化阶段把 .env 写进 process.env，
  // 因此 app.listen 这里能拿到（对比：src/common/snowflake-id.ts 在 import 阶段就读 env，拿不到）
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
