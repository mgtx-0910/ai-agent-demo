import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateDocumentDto } from './create-document.dto';

/**
 * 更新文档入参（PATCH 语义：字段传了才改，不传就保持原值）
 *
 * 由 CreateDocumentDto 派生而来，省掉重复声明校验规则：
 *   OmitType(..., ['createBy'])  剔除 createBy —— 创建人不可被修改
 *   PartialType(...)             把剩余字段全部变成可选
 * 于是换成了语义更准确的 updateBy。
 *
 * 注意：校验规则会一并继承，因此 status 依旧只能传数字 0/1/2。
 */
export class UpdateDocumentDto extends PartialType(
  OmitType(CreateDocumentDto, ['createBy'] as const),
) {
  /** 更新人 ID（可选） */
  @IsOptional()
  @IsString()
  updateBy?: string;
}
