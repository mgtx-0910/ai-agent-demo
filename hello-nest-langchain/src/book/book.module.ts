import { Module } from '@nestjs/common';
import { BookService } from './book.service';
import { BookController } from './book.controller';

/**
 * BookModule — 图书管理模块
 *
 * 这个模块展示了如何使用自定义 Provider 提供"内存数据仓库"，
 * 模拟一个简单的 CRUD 场景，无需连接真实数据库。
 *
 * NestJS 的 CRUD（增删改查）对应 HTTP 方法：
 *   Create   → POST    /book
 *   Read     → GET     /book   /book/:id
 *   Update   → PATCH   /book/:id
 *   Delete   → DELETE  /book/:id
 */
@Module({
  controllers: [BookController],
  providers: [
    // ========== BookService（普通 Provider）==========
    BookService,

    // ========== BOOK_REPOSITORY（自定义 Provider）==========
    // 用字符串 token 注入一个内存模拟的书籍仓库
    {
      provide: 'BOOK_REPOSITORY', // token：用于 @Inject('BOOK_REPOSITORY') 注入
      /**
       * useFactory — 工厂函数
       *
       * 此处模拟了一个"内存数据库"：
       * - books 数组充当数据表，预置了 3 本书
       * - 返回的对象 { findAll } 相当于一个简化版的 Repository
       * - ...books（展开运算符）防止外部直接修改原始数组
       *
       * 在真实项目中，这里会被替换为 TypeORM / Prisma 等 ORM 的 Repository。
       * 例如：
       *   inject: [DataSource],
       *   useFactory: (ds: DataSource) => ds.getRepository(Book),
       */
      useFactory() {
        // 模拟数据库中的 books 表，预置 3 条记录
        const books: { id: number; title: string }[] = [
          { id: 1, title: 'Book 1' },
          { id: 2, title: 'Book 2' },
          { id: 3, title: 'Book 3' },
        ];

        // 返回一个"仓库"对象，提供 findAll 方法
        // 可以不断扩展这个方法集合，模拟增删改查
        return {
          // findAll: 返回所有图书的副本（不影响原数组）
          findAll: () => [...books],
        };
      },
      // 此工厂函数无需外部依赖，所以不需要 inject
    },
  ],
})
export class BookModule {}
