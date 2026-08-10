import { Inject, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { EntityManager } from 'typeorm';
import { User } from './entities/user.entity';

/**
 * UsersService — 基于 TypeORM 的数据库用户服务
 *
 * 通过注入 EntityManager 直接操作 MySQL 中的 User 实体，
 * 提供 create / findAll / findOne / update / remove 五个方法。
 *
 * 与 ai/user.service.ts（内存版）的区别：
 * - UsersService 操作 MySQL 数据库，数据持久化
 * - UserService 操作内存 Map，应用重启后丢失（仅用于 AI 工具快速演示）
 */
@Injectable()
export class UsersService {
  /**
   * TypeORM EntityManager — 直接操作实体的底层 API
   * save / find / findOne / update / delete 方法由 EntityManager 提供
   */
  @Inject(EntityManager)
  entityManager: EntityManager;

  /**
   * 创建新用户并保存到 MySQL
   *
   * @param createUserDto name + email（经 class-validator 校验）
   * @returns 保存后的 User 实体（含自增 id、createdAt、updatedAt）
   */
  create(createUserDto: CreateUserDto): Promise<User> {
    return this.entityManager.save(User, createUserDto);
  }

  /**
   * 获取所有用户
   */
  findAll(): Promise<User[]> {
    return this.entityManager.find(User);
  }

  /**
   * 按 ID 查找单个用户
   *
   * @param id 用户自增主键 ID
   * @returns User 实体或 null
   */
  findOne(id: number): Promise<User | null> {
    return this.entityManager.findOne(User, { where: { id } });
  }

  /**
   * 更新用户信息（部分更新）
   *
   * @param id 用户 ID
   * @param updateUserDto 要更新的字段（全部可选）
   * @returns TypeORM UpdateResult
   */
  update(
    id: number,
    updateUserDto: UpdateUserDto,
  ): Promise<import('typeorm').UpdateResult> {
    return this.entityManager.update(User, id, updateUserDto);
  }

  /**
   * 删除用户
   *
   * @param id 用户 ID
   * @returns TypeORM DeleteResult
   */
  remove(id: number): Promise<import('typeorm').DeleteResult> {
    return this.entityManager.delete(User, id);
  }
}
