import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * User — TypeORM 实体，映射 MySQL users 表
 *
 * 字段：
 * - id：自增主键
 * - name：用户名，最长 50 字符
 * - email：邮箱，最长 50 字符
 * - createdAt：创建时间，自动填充
 * - updatedAt：更新时间，自动更新
 */
@Entity()
export class User {
  /**
   * 自增主键 ID
   */
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * 用户名
   */
  @Column({
    length: 50,
  })
  name: string;

  /**
   * 邮箱
   */
  @Column({
    length: 50,
  })
  email: string;

  /**
   * 创建时间 — TypeORM 自动填充当前时间
   */
  @CreateDateColumn({
    type: 'timestamp',
  })
  createdAt: Date;

  /**
   * 更新时间 — TypeORM 在每次 save/update 时自动更新
   */
  @UpdateDateColumn({
    type: 'timestamp',
  })
  updatedAt: Date;
}
