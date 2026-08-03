import { PartialType } from '@nestjs/mapped-types';
import { CreateBookDto } from './create-book.dto';

/**
 * UpdateBookDto — 更新图书的请求体数据格式
 *
 * PartialType 是 @nestjs/mapped-types 提供的工具函数：
 *
 * PartialType(CreateBookDto) 的作用：
 * - 继承 CreateBookDto 的所有字段
 * - 但将所有字段变为可选（optional）
 * - 相当于 TypeScript 的 Partial<CreateBookDto>
 *
 * 为什么要这样做？
 * - PATCH 请求通常只传需要修改的字段，不是全部字段
 * - 例如：只改书名，请求体就是 { "title": "新书名" }，不需要传 author
 * - PartialType 确保字段都是可选的，允许部分更新
 *
 * mapped-types 还提供其他实用工具：
 * - PickType(CreateBookDto, ['title'])  — 只选部分字段
 * - OmitType(CreateBookDto, ['id'])     — 排除某些字段
 * - IntersectionType(A, B)              — 合并多个类型
 */
export class UpdateBookDto extends PartialType(CreateBookDto) {}
