import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 定时任务类型联合类型
 * - cron：按 Cron 表达式循环执行
 * - every：按固定毫秒间隔循环执行
 * - at：在指定时间点执行一次后自动停用
 */
export type JobType = 'cron' | 'every' | 'at';

/**
 * Job — TypeORM 实体，映射 MySQL job 表
 *
 * 存储定时任务的配置信息，支持三种执行模式：
 * - cron：cron 字段存 Cron 表达式
 * - every：everyMs 字段存毫秒间隔
 * - at：at 字段存目标时间点（执行后自动停用）
 *
 * instruction 字段存储自然语言任务指令，
 * 定时触发时由 JobAgentService 解析并执行。
 */
@Entity()
export class Job {
  /**
   * UUID 主键，自动生成
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 任务指令 — 自然语言描述的任务内容
   */
  @Column({ type: 'text' })
  instruction: string;

  /**
   * 任务类型：cron / every / at
   */
  @Column({ type: 'varchar', length: 10, default: 'cron' })
  type: JobType;

  /**
   * Cron 表达式（type=cron 时使用）
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  cron: string | null;

  /**
   * 固定间隔毫秒（type=every 时使用）
   */
  @Column({ type: 'int', nullable: true })
  everyMs: number | null;

  /**
   * 指定触发时间点（type=at 时使用，执行后自动停用）
   */
  @Column({ type: 'timestamp', nullable: true })
  at: Date | null;

  /**
   * 是否启用 — 为 false 时不会恢复运行
   */
  @Column({ default: true })
  isEnabled: boolean;

  /**
   * 上次执行时间
   */
  @Column({ type: 'timestamp', nullable: true })
  lastRun: Date | null;

  /**
   * 创建时间 — TypeORM 自动填充
   */
  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  /**
   * 更新时间 — TypeORM 自动更新
   */
  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
