/**
 * CreateUserDto：创建用户时的请求体验证模型（DTO，Data Transfer Object）
 *
 * 真实项目中会用 class-validator 装饰器（@IsString / @IsInt 等）做运行时校验，
 * 再配合全局 ValidationPipe 自动拦截非法请求。本示例聚焦 Nest 请求生命周期，
 * 暂未引入校验库，仅用类型约束。
 */
export class CreateUserDto {
  username: string;
  name: string;
  age: number;
}
