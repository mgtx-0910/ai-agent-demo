import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

/**
 * UpdateUserDto — 更新用户的请求体数据校验
 *
 * 通过 PartialType(CreateUserDto) 继承 CreateUserDto 的所有字段，
 * 并将每个字段变为可选（即更新时只需提供要修改的字段）。
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {}
