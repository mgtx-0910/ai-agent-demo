import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';
import * as fs from 'fs';

/**
 * 独立脚本：生成 openapi.json 文档
 *
 * 使用方式：
 *   npx ts-node src/generate-openapi.ts
 *
 * 注意：需要本地 MySQL 服务可用，因为 AppModule 依赖 TypeORM 连接。
 * 生成的文件保存在项目根目录 openapi.json。
 */
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Cron Job Tool API')
    .setDescription('基于 NestJS + LangChain 的定时任务管理系统 API')
    .setVersion('1.0.0')
    .addTag('根', '应用根路由')
    .addTag('AI', 'AI 对话接口')
    .addTag('用户', '用户 CRUD 接口')
    .build();

  const document: OpenAPIObject = SwaggerModule.createDocument(app, config);
  fs.writeFileSync('./openapi.json', JSON.stringify(document, null, 2));

  console.log('✅ openapi.json 已生成！');
  await app.close();
}

void generate();
