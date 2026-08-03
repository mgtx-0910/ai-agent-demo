/**
 * Book Entity — 图书实体类
 *
 * Entity（实体）代表数据库中的一张表：
 * - 每个属性对应表中的一个字段
 * - 在 ORM 中用于定义表结构和字段映射
 *
 * 当前 Entity 是空的，仅作为概念占位。
 *
 * 实际项目中（如 TypeORM）：
 *   @Entity()
 *   export class Book {
 *     @PrimaryGeneratedColumn()
 *     id: number;
 *
 *     @Column()
 *     title: string;
 *
 *     @Column()
 *     author: string;
 *
 *     @CreateDateColumn()
 *     createdAt: Date;
 *   }
 *
 * Entity vs DTO 的区别：
 * - Entity：  数据库表结构，与数据库字段一一对应
 * - DTO：     API 的请求/响应格式，可能与表结构不同
 *             例如 DTO 可以隐藏某些字段（如密码）或合并多表数据
 */
export class Book {}
