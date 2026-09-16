import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { DocumentService } from './document.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { QueryDocumentDto } from './dto/query-document.dto';

/**
 * 文档接口（统一前缀 /documents）
 *
 * Controller 只做三件事：收参数、调 Service、返回结果。
 * 校验（class-validator）由 main.ts 的全局 ValidationPipe 完成，这里不写 if 判断。
 *
 * | 方法 | 路径 | 语义 |
 * | --- | --- | --- |
 * | POST | /documents | 新建文档（元数据 + 正文双写） |
 * | GET | /documents | 分页列表，只回元数据，不回正文 |
 * | GET | /documents/:id | 详情，附带 Mongo 正文 |
 * | PATCH | /documents/:id | 局部更新（字段传了才改） |
 * | DELETE | /documents/:id | 软删除（PG + Mongo 双侧标记 deleted） |
 */
@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  /** 创建文档：body 必须符合 CreateDocumentDto，多余字段会被 400 拒绝 */
  @Post()
  create(@Body() dto: CreateDocumentDto) {
    return this.documentService.create(dto);
  }

  /** 分页查询文档列表（仅元数据）：查询条件与分页参数都在 QueryDocumentDto 中校验 */
  @Get()
  findAll(@Query() query: QueryDocumentDto) {
    return this.documentService.findAll(query);
  }

  /**
   * 查询文档详情（含正文）
   * @param id 雪花 ID，以字符串传递（64 位整数超出 JS number 安全范围）
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentService.findOne(id);
  }

  /** 更新文档：PATCH 语义，DTO 里所有字段都是可选的 */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return this.documentService.update(id, dto);
  }

  /** 软删除文档：数据仍在库里，只是标记 deleted = true */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentService.remove(id);
  }
}
