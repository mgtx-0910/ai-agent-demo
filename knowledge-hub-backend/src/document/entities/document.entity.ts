import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer } from '../../common/transformers/bigint.transformer';

/**
 * 文档状态
 * 存进 PG 的是数字（smallint），不是字符串，便于索引与范围查询。
 */
export enum DocumentStatus {
  /** 草稿：不对外可见 */
  Draft = 0,
  /** 已发布：可被检索 / 展示，首次置为该状态时写入 publishTime */
  Published = 1,
  /** 已归档：不再作为知识被检索，但保留历史记录 */
  Archived = 2,
}

/**
 * 文档元数据（PostgreSQL 表 kh_document）
 *
 * 与 init-scripts/postgresql/init.sql 一一对应，改结构要两边同时改。
 * 正文不在本表：只存 content_id 指向 Mongo document_content._id。
 *
 * 字段命名约定：代码用 camelCase，通过 name 映射到数据库的 snake_case。
 * 所有 BIGINT 列都挂 bigintTransformer，统一在 TS 侧用 string 表示。
 */
@Entity('kh_document')
export class DocumentEntity {
  /** 雪花 ID（BIGINT）。业务主键，不用自增，避免多实例写库时冲突 */
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: string;

  /** 标题 */
  @Column({ type: 'varchar' })
  title: string;

  /**
   * Mongo 正文文档的 ObjectId（24 位十六进制字符串）
   * unique 保证一个正文不会被两条元数据引用
   */
  @Column({ name: 'content_id', type: 'varchar', unique: true })
  contentId: string;

  /** 摘要（列表页展示用；未显式传时由正文截取） */
  @Column({ type: 'varchar', nullable: true })
  summary?: string | null;

  /** 分类 ID（BIGINT，外键未建，跨服务由应用层保证有效性） */
  @Column({
    name: 'category_id',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  categoryId?: string | null;

  /** 团队 ID（BIGINT） */
  @Column({
    name: 'team_id',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  teamId?: string | null;

  /** 作者 ID（BIGINT） */
  @Column({
    name: 'author_id',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  authorId?: string | null;

  /** 封面图 URL */
  @Column({ name: 'cover_image', type: 'varchar', nullable: true })
  coverImage?: string | null;

  /** 标签（逗号分隔），如 "入职,研发中心,onboarding" */
  @Column({ type: 'varchar', nullable: true })
  tags?: string | null;

  /** 状态：0 草稿 / 1 已发布 / 2 已归档，默认草稿 */
  @Column({ type: 'smallint', default: DocumentStatus.Draft })
  status: DocumentStatus;

  /** 备注（内部说明，不对外展示） */
  @Column({ type: 'varchar', nullable: true })
  remark?: string | null;

  // —— 下面 5 个计数字段由业务（浏览 / 点赞动作）累加维护，本 CRUD 接口只读 ——

  /** 浏览数 */
  @Column({ name: 'view_count', type: 'int', default: 0 })
  viewCount: number;

  /** 点赞数 */
  @Column({ name: 'like_count', type: 'int', default: 0 })
  likeCount: number;

  /** 评论数 */
  @Column({ name: 'comment_count', type: 'int', default: 0 })
  commentCount: number;

  /** 收藏数 */
  @Column({ name: 'favourite_count', type: 'int', default: 0 })
  favouriteCount: number;

  /** 字数（中英混合统计，创建 / 更新正文时自动重算） */
  @Column({ name: 'word_count', type: 'int', default: 0 })
  wordCount: number;

  /** 发布时间：仅「首次变为已发布」时写入，之后再次编辑不覆盖 */
  @Column({ name: 'publish_time', type: 'timestamp', nullable: true })
  publishTime?: Date | null;

  /** 是否公开（false 时仅作者 / 团队可见，过滤逻辑待后续权限模块实现） */
  @Column({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean;

  /** 创建时间：TypeORM 在 save 时自动写入（DDL 里也有 DEFAULT NOW() 兜底） */
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  /** 更新时间：TypeORM 在每次 save 时自动刷新，列表按它倒排可做「最近更新」 */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  /** 创建人 ID（BIGINT） */
  @Column({
    name: 'create_by',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  createBy?: string | null;

  /** 更新人 ID（BIGINT） */
  @Column({
    name: 'update_by',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  updateBy?: string | null;

  /** 逻辑删除标记：查询一律带 deleted = false，不做物理删除 */
  @Column({ type: 'boolean', default: false })
  deleted: boolean;
}
