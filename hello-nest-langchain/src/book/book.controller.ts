import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { BookService } from './book.service';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';

/**
 * BookController — 图书管理控制器（完整 CRUD）
 *
 * 路由前缀：@Controller('book') → 所有路径以 /book 开头
 *
 * 装饰器速查（RESTful API 标准）：
 * ┌──────────────┬──────────────────────────────────────┐
 * │  装饰器       │  作用                                 │
 * ├──────────────┼──────────────────────────────────────┤
 * │ @Post()      │  创建资源，映射 POST 请求               │
 * │ @Get()       │  读取资源，映射 GET 请求                │
 * │ @Get(':id')  │  读取单个资源，:id 是路径参数            │
 * │ @Patch(':id')│  部分更新资源，映射 PATCH 请求           │
 * │ @Delete(':id')│ 删除资源，映射 DELETE 请求             │
 * │ @Body()      │  提取 HTTP 请求体（JSON → 对象）        │
 * │ @Param('id') │  提取路径参数 /book/123 → id = "123"  │
 * └──────────────┴──────────────────────────────────────┘
 *
 * 注：PATCH vs PUT
 * - PATCH：部分更新，只传需要修改的字段
 * - PUT：完整替换，需要传整个对象
 */
@Controller('book')
export class BookController {
  // 构造函数注入 BookService
  constructor(private readonly bookService: BookService) {}

  /**
   * ========== POST /book ==========
   *
   * 创建一本新书。
   *
   * @Body() 提取请求体，Nest 自动将 JSON 解析为 CreateBookDto 对象
   * DTO（Data Transfer Object）：数据传输对象，
   * 用于定义和校验客户端传过来的数据结构
   *
   * 请求示例：
   *   POST /book
   *   Body: { "title": "1984", "author": "George Orwell" }
   */
  @Post()
  create(@Body() createBookDto: CreateBookDto) {
    return this.bookService.create(createBookDto);
  }

  /**
   * ========== GET /book ==========
   *
   * 获取所有图书列表。
   * 无需参数，直接返回全部记录。
   */
  @Get()
  findAll() {
    return this.bookService.findAll();
  }

  /**
   * ========== GET /book/:id ==========
   *
   * 获取指定 ID 的图书。
   *
   * @Param('id') 提取路径参数：
   *   GET /book/42 → id = "42"（注意是字符串）
   *
   * +id 是 JavaScript 的一元加号运算符，将字符串转为数字：
   *   +"42" → 42
   *   +"abc" → NaN（不是数字时返回 Not a Number）
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bookService.findOne(+id);
  }

  /**
   * ========== PATCH /book/:id ==========
   *
   * 部分更新指定 ID 的图书。
   *
   * @Param('id')  — 从 URL 路径提取图书 ID
   * @Body()       — 从请求体提取需要更新的字段
   *
   * 请求示例：
   *   PATCH /book/1
   *   Body: { "title": "动物农场" }   ← 只更新书名
   */
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateBookDto: UpdateBookDto) {
    return this.bookService.update(+id, updateBookDto);
  }

  /**
   * ========== DELETE /book/:id ==========
   *
   * 删除指定 ID 的图书。
   *
   * 请求示例：
   *   DELETE /book/3
   */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.bookService.remove(+id);
  }
}
