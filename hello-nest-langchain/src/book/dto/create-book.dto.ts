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
 *
 * 当前 DTO 是空的，表示暂时没有需要校验的字段。
 * 实际项目中可以添加字段和校验装饰器，例如：
 *   @IsString()
 *   @IsNotEmpty()
 *   title: string;
 *
 *   @IsString()
 *   author: string;
 */
export class CreateBookDto {}
