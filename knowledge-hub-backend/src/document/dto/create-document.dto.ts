import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { DocumentStatus } from '../entities/document.entity';

/**
 * 创建文档入参
 *
 * 两个必填字段：
 *   title   文档标题（进 PG）
 *   content Markdown 正文（进 Mongo）
 * 其余都可选，缺省值在 DocumentService.create 里兜底：
 *   status     → Draft(0)
 *   isPublic   → false
 *   wordCount  → 由 content 自动统计，不接受外部传入
 *   summary    → 未传时从正文截取前 200 字
 *
 * 提醒：全局 ValidationPipe 开了 forbidNonWhitelisted，
 * 传这里没声明的字段（如 wordCount、id）会直接 400。
 */
export class CreateDocumentDto {
  /** 标题（必填） */
  @IsString()
  title: string;

  /** Markdown 正文（必填）。正文不入 PG，只写入 Mongo document_content */
  @IsString()
  content: string;

  /** 摘要（可选）。同时会写到 PG.summary 与 Mongo.contentSummary */
  @IsOptional()
  @IsString()
  summary?: string;

  /** 分类 ID（可选，字符串形式的雪花 ID，PG 里是 BIGINT） */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** 团队 ID（可选，用于按团队隔离可见范围） */
  @IsOptional()
  @IsString()
  teamId?: string;

  /** 作者 ID（可选） */
  @IsOptional()
  @IsString()
  authorId?: string;

  /** 封面图 URL（可选） */
  @IsOptional()
  @IsString()
  coverImage?: string;

  /** 标签（可选，逗号分隔的字符串而不是数组，与 PG 的 varchar 列保持一致） */
  @IsOptional()
  @IsString()
  tags?: string;

  /**
   * 状态（可选，默认 0 草稿）
   * 由 @IsEnum 校验，JSON 里要传枚举的「值」而不是名字：
   * 正确 status: 1；错误 status: "1"（字符串）、"Published"（名字）都会被 400 拒绝
   */
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  /** 备注（可选，运维 / 审核用的内部说明） */
  @IsOptional()
  @IsString()
  remark?: string;

  /** 是否公开（可选，默认 false） */
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  /** 创建人 ID（可选）。同时会被写入 createBy 与 updateBy */
  @IsOptional()
  @IsString()
  createBy?: string;
}
