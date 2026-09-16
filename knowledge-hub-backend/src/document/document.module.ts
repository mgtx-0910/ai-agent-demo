import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';
import {
  DocumentContent,
  DocumentContentSchema,
} from './schemas/document-content.schema';

/**
 * 文档模块
 *
 * 注意这里只注册了 Mongo 侧的 DocumentContent：
 *   - PG 侧走的是 EntityManager（app.module 已建好连接），不需要再 forFeature
 *   - Mongo 侧必须 forFeature 注册模型，@InjectModel(DocumentContent.name) 才能注入
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DocumentContent.name, schema: DocumentContentSchema },
    ]),
  ],
  controllers: [DocumentController],
  providers: [DocumentService],
  // 导出给其他模块复用（如后续的检索 / 权限模块）
  exports: [DocumentService],
})
export class DocumentModule {}
