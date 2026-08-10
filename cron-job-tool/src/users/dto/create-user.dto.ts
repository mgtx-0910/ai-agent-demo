/* eslint-disable @typescript-eslint/no-unsafe-call -- class-validator 装饰器类型限制，标准 NestJS DTO 写法 */
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * CreateUserDto — 创建用户的请求体数据校验
 *
 * - name：非空，最大 50 字符
 * - email：非空，email 格式，最大 50 字符
 */
export class CreateUserDto {
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsNotEmpty()
  @IsEmail()
  @MaxLength(50)
  email: string;
}
