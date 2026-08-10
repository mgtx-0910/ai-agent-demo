/* eslint-disable @typescript-eslint/no-unsafe-call -- class-validator 装饰器类型限制，标准 NestJS DTO 写法 */
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * CreateUserDto — 创建用户的请求体数据校验
 *
 * - name：非空，最大 50 字符
 * - email：非空，email 格式，最大 50 字符
 */
export class CreateUserDto {
  @ApiProperty({ description: '用户名', example: '张三', maxLength: 50 })
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ description: '邮箱地址', example: 'zhangsan@example.com', maxLength: 50 })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(50)
  email: string;
}
