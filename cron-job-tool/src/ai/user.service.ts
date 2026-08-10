import { Injectable } from '@nestjs/common';

/**
 * 内存用户数据类型
 */
type User = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/**
 * UserService — 内存用户数据服务
 *
 * 使用 Map<string, User> 存储 6 个预设用户（赵云、诸葛亮、关羽、张飞、刘备、黄忠），
 * 供 ai.module.ts 中的 QUERY_USER_TOOL 内联工具使用。
 *
 * 注意：这是面向 AI 查询的内存版本用户服务，
 * 与 UsersService（操作 MySQL 数据库的版本）是两个独立实现。
 */
@Injectable()
export class UserService {
  private readonly users = new Map<string, User>([
    [
      '001',
      { id: '001', name: '赵云', email: 'zhaoyun@example.com', role: 'admin' },
    ],
    [
      '002',
      {
        id: '002',
        name: '诸葛亮',
        email: 'zhugeliang@example.com',
        role: 'manager',
      },
    ],
    [
      '003',
      { id: '003', name: '关羽', email: 'guanyu@example.com', role: 'user' },
    ],
    [
      '004',
      { id: '004', name: '张飞', email: 'zhangfei@example.com', role: 'user' },
    ],
    [
      '005',
      { id: '005', name: '刘备', email: 'liubei@example.com', role: 'owner' },
    ],
    [
      '006',
      {
        id: '006',
        name: '黄忠',
        email: 'huangzhong@example.com',
        role: 'user',
      },
    ],
  ]);

  /**
   * 获取所有用户列表
   */
  findAll(): User[] {
    return Array.from(this.users.values());
  }

  /**
   * 按 ID 查找单个用户
   *
   * @param id 用户 ID（如 '001'）
   */
  findOne(id: string): User | undefined {
    return this.users.get(id);
  }

  /**
   * 创建新用户（内存操作，应用重启后丢失）
   *
   * @param user 完整的 User 对象
   */
  create(user: User): User {
    this.users.set(user.id, user);
    return user;
  }

  /**
   * 更新用户信息（内存操作）
   *
   * @param id 用户 ID
   * @param partial 要更新的字段（排除 id，id 不可变）
   */
  update(id: string, partial: Partial<Omit<User, 'id'>>): User | undefined {
    const existing = this.users.get(id);
    if (!existing) {
      return undefined;
    }

    const updated: User = {
      ...existing,
      ...partial,
      id: existing.id,
    };

    this.users.set(id, updated);
    return updated;
  }

  /**
   * 删除用户（内存操作）
   *
   * @param id 用户 ID
   */
  remove(id: string): boolean {
    return this.users.delete(id);
  }
}
