import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DocumentModule } from './document/document.module';
import { DocumentEntity } from './document/entities/document.entity';

/**
 * 根模块：只做「基础设施装配」，不写业务
 *
 * 三个 import 各司其职：
 *   ConfigModule  —— 读 .env，并且 isGlobal 让任何地方都能直接注入 ConfigService
 *   TypeOrmModule —— PostgreSQL 连接（存文档元数据，关系型、需要事务与条件查询）
 *   MongooseModule—— MongoDB 连接（存 Markdown 正文，长文本、结构松散）
 *
 * 为什么用两套数据库：元数据要按分类 / 团队 / 状态过滤 + 分页统计，交给 PG 最自然；
 * 正文是几 KB 到几十 KB 的 Markdown，且以后可能挂向量、附件，放 Mongo 更灵活。
 * 两者通过「雪花 ID + content_id」关联，见 DocumentService。
 */
@Module({
  imports: [
    // 全局配置：加载根目录 .env 到 process.env，isGlobal 后无需在每个模块重复 import
    ConfigModule.forRoot({ isGlobal: true }),

    // PostgreSQL 连接（异步工厂：连接参数依赖 ConfigService，必须等 ConfigModule 先就绪）
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('POSTGRES_HOST', 'localhost'),
        port: config.get<number>('POSTGRES_PORT', 5432),
        username: config.get<string>('POSTGRES_USER', 'user'),
        password: config.get<string>('POSTGRES_PASSWORD', '123456'),
        database: config.get<string>('POSTGRES_DB', 'knowledge_hub'),
        // 显式登记实体：这样不必开 autoLoadEntities，连接建立时就能拿到完整的表结构映射
        entities: [DocumentEntity],
        // synchronize 必须保持 false
        //   1) 表结构由 init-scripts/postgresql/init.sql 显式建立，作为唯一事实来源
        //   2) 开启后 TypeORM 会按实体反向改表，生产环境有丢数据风险
        // 结论：表结构变更 = 改 init.sql（新环境重建）+ 改实体（代码映射）
        synchronize: false,
      }),
    }),

    // MongoDB 连接（完整 URI 走环境变量，含账号 / 库名 / authSource）
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>(
          'MONGO_URI',
          'mongodb://mongo_user:mongo_pass123@localhost:27017/knowledge_hub?authSource=admin',
        ),
      }),
    }),

    // 业务模块：文档的增删改查
    DocumentModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
