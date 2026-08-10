/* eslint-disable @typescript-eslint/no-unsafe-call -- class-validator 装饰器类型限制，标准 NestJS DTO 写法 */
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsNotEmpty()
  @IsEmail()
  @MaxLength(50)
  email: string;
}
