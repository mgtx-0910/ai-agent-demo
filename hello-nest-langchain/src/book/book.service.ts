import { Inject, Injectable } from '@nestjs/common';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { Book } from './entities/book.entity';

/** Book 数据仓库接口 */
interface BookRepository {
  findAll(): Promise<Book[]>;
}

/**
 * BookService — 图书业务逻辑层
 *
 * 分层说明：
 * - Controller（控制层）：接收 HTTP 请求，参数解析，调用 Service
 * - Service（服务层）：业务逻辑，数据处理
 * - Repository（数据层）：数据存储读写（此处用内存 mock 模拟）
 *
 * 依赖注入 @Inject：
 * - @Inject('BOOK_REPOSITORY') 告诉 Nest：从 DI 容器中取出
 *   token 为 'BOOK_REPOSITORY' 的实例注入到这里
 * - 这个 token 在 book.module.ts 的 providers 中定义
 * - private readonly 确保只能在构造函数中赋值一次
 */
@Injectable()
export class BookService {
  /**
   * @Inject('BOOK_REPOSITORY') — 注入自定义 Provider
   *
   * bookRepository 是在 book.module.ts 中通过工厂函数创建的内存仓库对象，
   * 目前提供了 findAll() 方法来获取所有图书。
   *
   * 如果将来要换成真实的数据库（如 MySQL/PostgreSQL），
   * 只需要修改 book.module.ts 中的 useFactory，
   * BookService 的代码无需任何改动——这就是 DI（依赖注入）的核心优势。
   */
  @Inject('BOOK_REPOSITORY')
  private readonly bookRepository: BookRepository;

  /**
   * 创建新书（GET /book）
   * 当前是占位实现，返回操作提示文本。
   *
   * @param createBookDto 客户端传来的新书数据
   */
  create(createBookDto: CreateBookDto) {
    void createBookDto; // DTO placeholder
    return 'This action adds a new book';
  }

  /**
   * 获取所有图书（GET /book）
   *
   * 实际调用了内存仓库中的 findAll() 方法，
   * 返回 book.module.ts 中预置的 3 本书的副本。
   *
   * 被注释掉的 return 是占位实现，
   * 当前调用真实的 repository 来展示"替换数据源"的效果。
   */
  findAll(): Promise<Book[]> {
    return this.bookRepository.findAll();
  }

  /**
   * 获取单本图书（GET /book/:id）
   * 当前是占位实现。
   *
   * @param id 图书 ID（已在 Controller 中通过 +id 转为 number）
   */
  findOne(id: number) {
    return `This action returns a #${id} book`;
  }

  /**
   * 更新图书（PATCH /book/:id）
   *
   * @param id 图书 ID
   * @param updateBookDto 需要更新的字段（PartialType 使所有字段可选）
   */
  update(id: number, updateBookDto: UpdateBookDto) {
    void updateBookDto; // DTO placeholder
    return `This action updates a #${id} book`;
  }

  /**
   * 删除图书（DELETE /book/:id）
   *
   * @param id 要删除的图书 ID
   */
  remove(id: number) {
    return `This action removes a #${id} book`;
  }
}
