import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * 文档列表查询入参（全部来自 URL query）
 *
 * 关键点：URL 里的参数一律是字符串，所以数值字段必须加 @Type(() => Number)，
 * 配合 main.ts 里 ValidationPipe 的 transform: true 才能转成数字，
 * 否则 @IsInt() 会拿 "2" 去校验而直接报错。
 *
 * 过滤条件之间是 AND 关系，条件不传即不参与 SQL 的 WHERE。
 */
export class QueryDocumentDto {
  /** 标题关键词，走 ILIKE 模糊匹配（大小写不敏感） */
  @IsOptional()
  @IsString()
  title?: string;

  /** 分类 ID 精确匹配 */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** 团队 ID 精确匹配 */
  @IsOptional()
  @IsString()
  teamId?: string;

  /** 作者 ID 精确匹配 */
  @IsOptional()
  @IsString()
  authorId?: string;

  /** 状态精确匹配（0/1/2）。注意用 @IsInt 而不是 @IsEnum：query 里传的是数字字符串 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;

  /** 页码，从 1 开始，默认 1 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** 每页条数，默认 20，上限 100（防止一次拉全表） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
