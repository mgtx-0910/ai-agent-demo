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
 * 生成的文件保存在项目根目录 openapi.json。
 */
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('hello-nest-langchain API')
    .setDescription('NestJS + LangChain AI Agent 学习项目接口文档')
    .setVersion('1.0')
    .addTag('根', '应用根路由')
    .addTag('AI', 'AI 对话接口')
    .addTag('图书', '图书 CRUD 接口')
    .build();

  const document: OpenAPIObject = SwaggerModule.createDocument(app, config);
  fs.writeFileSync('./openapi.json', JSON.stringify(document, null, 2));

  console.log('openapi.json generated successfully!');
  await app.close();
}

void generate();
