import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityManager } from 'typeorm';
import { nextSnowflakeId } from '../common/snowflake-id';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { QueryDocumentDto } from './dto/query-document.dto';
import {
  DocumentEntity,
  DocumentStatus,
} from './entities/document.entity';
import {
  DocumentContent,
  DocumentContentDocument,
} from './schemas/document-content.schema';

/**
 * 文档服务：本项目唯一涉及「双库写入」的地方
 *
 * 数据分工：
 *   元数据 → PostgreSQL kh_document（标题 / 分类 / 状态 / 计数 / 时间…）
 *   正文   → MongoDB document_content（Markdown 全文）
 *   关联   → kh_document.content_id ↔ document_content._id
 *            kh_document.id         ↔ document_content.documentId
 *
 * 一致性策略（重要）：
 *   Postgres 与 Mongo 是两个独立连接，无法共用事务，因此不做原子性承诺，改用「补偿 + 软删」：
 *   写   —— 先写 Mongo 拿 ObjectId，再写 PG；PG 失败就把刚写的 Mongo 正文物理删掉（create 里的 catch）
 *   更新 —— 先改 Mongo（正文 / 摘要），再 save PG；PG 失败会留下「新正文 + 旧元数据」，由调用方重试收敛
 *   删除 —— 两侧都只置 deleted = true，不物理删，出问题可人工比对修复
 *
 * 一个已知的取舍：接口层 summary 与 Mongo 侧 contentSummary 是两份数据，
 * 只传 content 不传 summary 时会重算 contentSummary，而 PG.summary 保持旧值（见 update 注释）。
 */
@Injectable()
export class DocumentService {
  constructor(
    /** Postgres 实体管理器：直接用 EntityManager 执行 save / QueryBuilder，无需为实体单独建 Repository */
    @InjectEntityManager()
    private readonly em: EntityManager,
    /** Mongo 正文模型：由 DocumentModule 的 forFeature 注册后注入 */
    @InjectModel(DocumentContent.name)
    private readonly contentModel: Model<DocumentContentDocument>,
  ) {}

  /**
   * 创建文档
   *
   * 流程：生成雪花 ID → 写 Mongo 正文（拿 ObjectId）→ 写 Postgres 元数据
   * 失败补偿：PG 写入抛错时，物理删除已写入的 Mongo 正文，避免留下「孤儿正文」
   *
   * 为什么是这个顺序：Mongo 的 _id 是 PG 侧 content_id 的来源，
   * 必须先在 Mongo 落地才能拿到；反过来先写 PG 则要回填 content_id，补偿更麻烦。
   */
  async create(dto: CreateDocumentDto) {
    // ① 主键用雪花 ID：多实例部署也不会撞号，同时是 BIGINT，PG 侧走 string 传输
    const id = nextSnowflakeId();
    // ② 字数由服务端统计，不接受客户端传入，避免造假
    const wordCount = this.countWords(dto.content);
    // ③ 状态缺省为草稿
    const status = dto.status ?? DocumentStatus.Draft;
    // ④ 未传 summary 时，从正文截取预览作为 contentSummary
    const contentSummary =
      dto.summary ?? this.buildContentSummary(dto.content);

    // ⑤ 先写 Mongo，_id 由驱动自动生成 ObjectId
    const contentDoc = await this.contentModel.create({
      documentId: id,
      content: dto.content,
      contentLength: dto.content.length,
      contentSummary,
      version: 1,
      deleted: false,
    });
    // ⑥ ObjectId 转字符串，存入 Postgres content_id
    const contentId = String(contentDoc._id);

    try {
      const doc = this.em.create(DocumentEntity, {
        id,
        title: dto.title,
        contentId,
        summary: dto.summary,
        categoryId: dto.categoryId,
        teamId: dto.teamId,
        authorId: dto.authorId,
        coverImage: dto.coverImage,
        tags: dto.tags,
        status,
        remark: dto.remark,
        isPublic: dto.isPublic ?? false,
        wordCount,
        // ⑦ 创建即发布时，记录发布时间（草稿则为 null）
        publishTime: status === DocumentStatus.Published ? new Date() : null,
        createBy: dto.createBy,
        // 首次创建时更新人 = 创建人
        updateBy: dto.createBy,
        deleted: false,
      });

      const saved = await this.em.save(doc);
      // ⑧ 统一在响应里带上正文，前端创建后无需再请求一次详情
      return { ...saved, content: dto.content };
    } catch (error) {
      // ⑨ 补偿：PG 失败 → 物理删除刚写入的 Mongo 正文（此处不能用软删，否则残留垃圾数据）
      await this.contentModel.deleteOne({ _id: contentDoc._id });
      throw error;
    }
  }

  /**
   * 分页查询文档列表（只返回 Postgres 元数据，不含正文）
   * 支持按标题模糊、分类 / 团队 / 作者 / 状态筛选
   *
   * 为什么不查 Mongo：列表只需要元数据，正文在别的库，
   * 「先查元数据再逐条取正文」会产生 N+1 次 Mongo 查询，列表页必须要正文时再按 id 批量取。
   */
  async findAll(query: QueryDocumentDto) {
    // DTO 已做默认值与范围校验（page ≥ 1、1 ≤ pageSize ≤ 100），这里再兜一次底
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // ① 默认排除已软删记录，后续条件全部 andWhere 叠加（AND 关系）
    //    注意 QueryBuilder 里写的是数据库列名（snake_case），不是实体属性名（camelCase）
    const qb = this.em
      .createQueryBuilder(DocumentEntity, 'doc')
      .where('doc.deleted = :deleted', { deleted: false });

    // ② 标题模糊匹配（不区分大小写）：ILIKE 是 Postgres 语法；参数化传值，无注入风险
    if (query.title) {
      qb.andWhere('doc.title ILIKE :title', { title: `%${query.title}%` });
    }
    if (query.categoryId) {
      qb.andWhere('doc.category_id = :categoryId', {
        categoryId: query.categoryId,
      });
    }
    if (query.teamId) {
      qb.andWhere('doc.team_id = :teamId', { teamId: query.teamId });
    }
    if (query.authorId) {
      qb.andWhere('doc.author_id = :authorId', { authorId: query.authorId });
    }
    // ③ status 用 !== undefined 判断：因为 0（草稿）是合法取值，用 if (query.status) 会把 0 漏掉
    if (query.status !== undefined) {
      qb.andWhere('doc.status = :status', { status: query.status });
    }

    // ④ 按创建时间倒序，再分页（skip/take 会翻译成 LIMIT / OFFSET）
    qb.orderBy('doc.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    // ⑤ getManyAndCount 会发两条 SQL：一条取当前页数据，一条 select count 求总数
    //    total 用于前端算总页数；数据量再大时应换成游标分页（按 id / created_at 翻页）
    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 查询文档详情
   * @param withContent 是否附带 Mongo 正文，默认 true；false 时只回 PG 元数据
   */
  async findOne(id: string, withContent = true) {
    // ① 先查元数据，顺手过滤掉已软删的文档（软删后详情应表现为不存在）
    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    if (!withContent) {
      return doc;
    }

    // ② 通过 content_id 拉取未删除的正文
    //    传字符串 Mongoose 会自动 cast 成 ObjectId；.lean() 返回纯对象，省掉一层包装开销
    const contentDoc = await this.contentModel
      .findOne({ _id: doc.contentId, deleted: false })
      .lean();
    // ③ 正文缺失时返回空串而不是报错：元数据仍可用，前端展示空正文即可
    return {
      ...doc,
      content: contentDoc?.content ?? '',
    };
  }

  /**
   * 更新文档（PATCH：字段传了才改）
   *
   * 分三块处理：
   *   正文     有 content → 更新 Mongo 正文 + 版本号 +1
   *   摘要     只有 summary 没 content → 只同步 Mongo 的 contentSummary
   *   元数据   标题 / 分类 / 团队 / 状态等 → 只落 PG
   * 另外：首次从「非发布」变为「已发布」时写入 publishTime（已发布的反复编辑不会刷新它）
   */
  async update(id: string, dto: UpdateDocumentDto) {
    // ① 先确认文档存在且未删除，不存在直接 404
    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    // —— 正文变更 ——
    if (dto.content !== undefined) {
      // 摘要优先用显式传入的 summary，否则用新正文重新生成预览
      const contentSummary =
        dto.summary ?? this.buildContentSummary(dto.content);
      const result = await this.contentModel.updateOne(
        { _id: doc.contentId, deleted: false },
        {
          $set: {
            content: dto.content,
            contentLength: dto.content.length,
            contentSummary,
          },
          $inc: { version: 1 }, // 版本号 +1，标识正文确实变过
        },
      );
      // ② matchedCount = 0 说明正文文档不存在（或已被软删）：
      //    此处必须报错，否则会出现「PG 元数据更新成功、正文其实没改」的静默不一致
      if (result.matchedCount === 0) {
        throw new BadRequestException(
          `Document content ${doc.contentId} not found`,
        );
      }
      // ③ 字数随正文变化重算，待会儿随元数据一起落库
      doc.wordCount = this.countWords(dto.content);
    } else if (dto.summary !== undefined) {
      // 只改摘要时，同步 Mongo 侧预览字段（正文不动，version 也不加）
      await this.contentModel.updateOne(
        { _id: doc.contentId, deleted: false },
        { $set: { contentSummary: dto.summary } },
      );
    }

    // —— 元数据字段（有传才覆盖，逐个判断而不是整体替换，天然支持局部更新）——
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.summary !== undefined) doc.summary = dto.summary;
    if (dto.categoryId !== undefined) doc.categoryId = dto.categoryId;
    if (dto.teamId !== undefined) doc.teamId = dto.teamId;
    if (dto.authorId !== undefined) doc.authorId = dto.authorId;
    if (dto.coverImage !== undefined) doc.coverImage = dto.coverImage;
    if (dto.tags !== undefined) doc.tags = dto.tags;
    if (dto.remark !== undefined) doc.remark = dto.remark;
    if (dto.isPublic !== undefined) doc.isPublic = dto.isPublic;
    if (dto.updateBy !== undefined) doc.updateBy = dto.updateBy;

    // 状态从「非发布」→「发布」时记录发布时间；重复保存已发布文档不会刷掉首次发布时间
    if (dto.status !== undefined) {
      if (
        dto.status === DocumentStatus.Published &&
        doc.status !== DocumentStatus.Published
      ) {
        doc.publishTime = new Date();
      }
      doc.status = dto.status;
    }

    // save 会带上 updated_at（@UpdateDateColumn 自动刷新）
    const saved = await this.em.save(doc);

    // 本次已带新正文则直接返回（省一次 Mongo 查询）；
    // 注意 Mongo 的 contentSummary 可能与 PG.summary 不一致（只传 content 时按正文重算）
    if (dto.content !== undefined) {
      return { ...saved, content: dto.content };
    }

    // 没带正文时回查一次 Mongo，保证响应结构稳定（始终有 content 字段）
    const contentDoc = await this.contentModel
      .findOne({ _id: doc.contentId, deleted: false })
      .lean();
    return { ...saved, content: contentDoc?.content ?? '' };
  }

  /**
   * 软删除文档
   * Postgres、Mongo 两侧都将 deleted 置为 true（不物理删正文）
   *
   * 这样做的原因：删除是低频高风险操作，保留数据可支撑恢复、审计与对账；
   * 代价是所有查询都必须记得带上 deleted = false 条件。
   */
  async remove(id: string) {
    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    // ① PG：先置标记（失败则整体失败，Mongo 未动，状态一致）
    doc.deleted = true;
    await this.em.save(doc);
    // ② Mongo：按 _id 置标记（这里不校验 deleted: false，重复删除保持幂等）
    await this.contentModel.updateOne(
      { _id: doc.contentId },
      { $set: { deleted: true } },
    );
    // ③ 不返回被删对象内容，只回执结果，避免误用
    return { id, deleted: true };
  }

  /**
   * 从正文截取预览摘要
   * 压缩连续空白后截断到 maxLen，超出则追加省略号
   *
   * 先把 \n \t 等压成单个空格，是为了让摘要在一行里也能读通顺。
   */
  private buildContentSummary(content: string, maxLen = 200): string {
    const trimmed = content.trim().replace(/\s+/g, ' ');
    return trimmed.length <= maxLen
      ? trimmed
      : `${trimmed.slice(0, maxLen)}...`;
  }

  /**
   * 统计正文字数（中英混合）
   * - 中日韩汉字：每个字符计 1 字
   * - 英文等拉丁文本：按空白分词，每个单词计 1 字
   *
   * 说明：这是「字数」而非「字符数」（contentLength 才是字符数）；
   * Markdown 标记符号（# 、- 等）也会被算进拉丁词计数，做精确统计需先剥离语法。
   */
  private countWords(content: string): number {
    const trimmed = content.trim();
    if (!trimmed) return 0;

    // ① 匹配所有 CJK 统一汉字（U+4E00–U+9FFF），每个汉字算 1
    const cjk = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length;

    // ② 去掉汉字后，剩余按空白切分为英文单词再计数
    const latin = trimmed
      .replace(/[\u4e00-\u9fff]/g, ' ') // 汉字替换为空格，避免「中文English」被当成一个词
      .trim()
      .split(/\s+/) // 按连续空白分词
      .filter(Boolean).length; // 去掉空串

    return cjk + latin;
  }
}
