import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Mongoose 文档类型：DocumentContent 的定义 + 实例方法 / 文档属性 */
export type DocumentContentDocument = HydratedDocument<DocumentContent>;

/**
 * 文档正文（MongoDB 集合 document_content）
 *
 * 与 PG kh_document 是一对一关系，靠两个字段互指：
 *   _id          ←→ kh_document.content_id   （Mongo 主键，由驱动生成 ObjectId）
 *   documentId   ←→ kh_document.id           （雪花 ID 的字符串形式）
 *
 * 为什么正文单独放 Mongo：
 *   正文长度不可控（几 KB 到几十 KB），塞进 PG 会让元数据表的行宽、备份、列表查询都变差；
 *   而正文基本只在「详情页 / 检索」时按 _id 精确取用，天然适合文档库。
 */
@Schema({
  /** 集合名（不写会按类名自动复数化成 documentcontents） */
  collection: 'document_content',
  /** 自动维护 createdAt / updatedAt */
  timestamps: true,
  /** 关闭 __v 版本键：本场景不需要乐观锁，少一个无用字段 */
  versionKey: false,
})
export class DocumentContent {
  /** ObjectId 主键（TS 侧声明以便类型推导；实际由 Mongo 生成） */
  _id: Types.ObjectId;

  /** 关联的文档元数据 ID（kh_document.id），业务查询用，故建索引 */
  @Prop({ type: String, required: true, index: true })
  documentId: string;

  /** Markdown 正文 */
  @Prop({ type: String, required: true, default: '' })
  content: string;

  /** 正文字符数（content.length，非「字数」，只做长度参考） */
  @Prop({ type: Number, default: 0 })
  contentLength: number;

  /** 正文摘要 / 预览（默认取正文前 200 字，可被 summary 覆盖） */
  @Prop({ type: String, default: '' })
  contentSummary: string;

  /** 版本号：每次改正文 +1，用于识别「正文是否变过」 */
  @Prop({ type: Number, default: 1 })
  version: number;

  /** 逻辑删除：与 PG 侧同时标记，保证详情接口不会读到已删正文 */
  @Prop({ type: Boolean, default: false })
  deleted: boolean;
}

/** 由装饰器生成 Schema，供 MongooseModule.forFeature 注册 */
export const DocumentContentSchema =
  SchemaFactory.createForClass(DocumentContent);
