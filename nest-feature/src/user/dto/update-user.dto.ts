import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

/**
 * UpdateUserDto：更新用户时的请求体验证模型
 *
 * 继承 PartialType(CreateUserDto)：把 CreateUserDto 的所有字段变成"可选"。
 * 这样 PATCH 语义下可以只传要修改的字段（如只改 name），而 POST 时字段全必填。
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {}
