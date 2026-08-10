import { ApiProperty } from '@nestjs/swagger';

/**
 * CreateBookDto — 创建图书的请求体数据格式
 *
 * DTO（Data Transfer Object，数据传输对象）的核心作用：
 * 1. 定义 API 接口的请求/响应数据结构
 * 2. 配合 class-validator 进行数据校验（如必填、类型、长度等）
 * 3. 与 TypeScript 类型系统结合，提供编译时类型安全
 *
 * 使用流程：
 *   客户端发送 POST /book { "title": "...", "author": "..." }
 *   → Nest 用 CreateBookDto 反序列化 JSON
 *   → Controller 调用 Service 时传入类型安全的 DTO 对象
 */
export class CreateBookDto {
  @ApiProperty({ description: '书名', example: '三体' })
  title: string;

  @ApiProperty({ description: '作者', example: '刘慈欣' })
  author: string;
}
