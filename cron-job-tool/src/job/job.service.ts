import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { EntityManager } from 'typeorm';
import { Job } from './entities/job.entity';
import { JobAgentService } from '../ai/job-agent.service';

/**
 * JobService — 定时任务管理服务
 *
 * ─────────────────────────────────────────────────────────────────────
 * 还在对SchedulerRegistry或定时任务 迷惑？
 * ─────────────────────────────────────────────────────────────────────
 *
 * 这不是中间件（Middleware），也不是 Linux 的 crond 系统守护进程。
 * 本质是 @nestjs/schedule 调度模块 + cron(纯 JS 库) + JS 原生 setTimeout/setInterval。
 *
 * cron 表达式的执行原理（纯 JS，跨平台）：
 *   cron 表达式 "0 0 8 * * *"
 *     → cron 包解析 → 算出下一次触发时间
 *     → 用 setTimeout 等到那个时间
 *     → 到点执行回调
 *     → 重新计算下一次 → setTimeout 循环
 * 整个链路不依赖任何操作系统特性，Windows/Linux/macOS 都能跑。
 *
 *
 * ─────────────────────────────────────────────────────────────────────
 * 三种任务类型与底层实现对照
 * ─────────────────────────────────────────────────────────────────────
 * 类型       数据库 type      底层实现              典型场景
 * cron 定时  'cron'         cron 包的 CronJob      每天 8:00 发日报
 * 固定间隔   'every'        JS setInterval         每 30 秒查一次状态
 * 延迟一次   'at'           JS setTimeout          10 分钟后发提醒
 *
 *
 * ─────────────────────────────────────────────────────────────────────
 * 核心概念
 * ─────────────────────────────────────────────────────────────────────
 * 1) SchedulerRegistry（调度注册表）
 *    NestJS 提供的「全局登记处」，统一存放所有动态创建的定时任务。
 *    可用它：新增(addCronJob/addInterval/addTimeout)、取消(deleteCronJob)、
 *    查询(getCronJobs/getIntervals/getTimeouts)、手动触发(getCronJob().fire())。
 *    为什么用它？装饰器 @Cron() 只能写死在代码里，而本项目的任务是用户
 *    存数据库、运行时动态增删的，必须用 SchedulerRegistry 动态管理。
 *
 * 2) CronJob（npm 包 cron，不是 Linux crond）
 *    按「cron 表达式」执行，如 '0 0 8 * * *' = 每天 8:00（6 段 = 秒 分 时 日 月 周）。
 *    注意本项目用 6 段（带秒），和 Linux 原生 crond 的 5 段不一样。
 *    纯 JS 实现：解析 → 算时间 → setTimeout → 执行 → 循环，与操作系统无关。
 *
 * 3) setInterval（间隔任务，毫秒）
 *    每隔 N 毫秒执行一次；对应数据库 Job 的 type='every' 字段，用 everyMs 存间隔。
 *
 * 4) setTimeout（延迟任务，毫秒）
 *    等待 N 毫秒后执行一次（只跑一次）；对应数据库 Job 的 type='at' 字段，
 *    用 at 存一个「目标触发时间 Date」，运行时再换算成「还差多少毫秒」。
 *    注意：type 字符串在代码里是 'every' / 'at'，不是字面的 interval/timeout。
 *
 * 5) OnApplicationBootstrap 接口
 *    NestJS 生命周期钩子：应用启动完成、所有模块加载好后自动执行一次。
 *    本项目用它从数据库把「已启用(isEnabled)」的任务重新登记到
 *    SchedulerRegistry，实现「重启不丢任务」。
 *
 *
 * ── Job 实体关键字段（存数据库的那条记录）──────────────────────────────
 *  - id：任务唯一 id（UUID 字符串），同时被用作 SchedulerRegistry 的登记 key
 *  - instruction：给 AI 的指令文本（如"给张三发邮件"），到点后交给 JobAgentService 执行
 *  - type：'cron' | 'every' | 'at'，决定用哪种调度方式
 *  - cron：type='cron' 时的 cron 表达式，其余类型存 null
 *  - everyMs：type='every' 时的间隔毫秒数，其余类型存 null
 *  - at：type='at' 时的目标触发时间(Date)，其余类型存 null
 *  - isEnabled：是否启用（false 时不会登记到调度器）
 *  - lastRun：上次执行的时刻，每次跑完更新
 * ─────────────────────────────────────────────────────────────────────
 *
 * 负责定时任务的增删改查，以及底层定时任务的注册、取消和触发。
 * 支持三种执行模式：cron、interval、timeout。
 *
 * 依赖：@nestjs/schedule(SchedulerRegistry) + cron(CronJob)
 *      + TypeORM(EntityManager) + JobAgentService(AI 执行指令)。
 */
@Injectable()
export class JobService implements OnApplicationBootstrap {
  // 每个任务的实际执行都要记日志，方便排查「哪个任务什么时候跑了」
  private readonly logger = new Logger(JobService.name);

  // EntityManager：TypeORM 的「数据库操作手柄」。本类不用 @Repository 装饰的
  // 仓储类，而是直接注入全局 EntityManager 来对 Job 表做增删改查(find/save/update)。
  @Inject(EntityManager)
  private readonly entityManager: EntityManager;

  // SchedulerRegistry：上面概念里说的「调度注册表」，所有动态任务都登记在这里。
  // 这里持有它的引用，以便 start/stop/查询任务。
  @Inject(SchedulerRegistry)
  private readonly schedulerRegistry: SchedulerRegistry;

  // JobAgentService：真正「干活」的服务——把 instruction 交给 AI Agent 去执行
  // （AI 会自己决定调用发邮件/查用户等工具）。任务到点了就调它的 runJob()。
  @Inject(JobAgentService)
  private readonly jobAgentService: JobAgentService;

  // 生命周期钩子：应用启动完成后自动跑一次（只跑这一次）。
  // 作用 = 把数据库里「已启用」的任务重新挂到调度器上，保证服务重启后任务不丢。
  async onApplicationBootstrap() {
    // 1) 从数据库捞出所有 isEnabled=true 的任务
    const enabledJobs = await this.entityManager.find(Job, {
      where: { isEnabled: true },
    });
    // 2) 取当前调度器里已有的任务名册（三种类型分别在三个集合里）
    const cronJobs = this.schedulerRegistry.getCronJobs();
    const intervals = this.schedulerRegistry.getIntervals();
    const timeouts = this.schedulerRegistry.getTimeouts();

    // 3) 逐个任务：如果调度器里已经有了就跳过（避免重复登记），
    //    否则调用 startRuntime 真正登记并启动。
    for (const job of enabledJobs) {
      const alreadyRegistered =
        (job.type === 'cron' && cronJobs.has(job.id)) ||
        (job.type === 'every' && intervals.includes(job.id)) ||
        (job.type === 'at' && timeouts.includes(job.id));
      if (alreadyRegistered) continue;

      this.startRuntime(job);
    }
  }

  // 列出所有任务，并额外算出每个任务「当前是否在跑」(running 字段)。
  // 注意：数据库里只存 isEnabled（是否启用），是否真的在调度器里跑，
  // 要实时查 SchedulerRegistry 才能知道。
  async listJobs(): Promise<(Job & { running: boolean })[]> {
    // 从数据库取全部任务，按创建时间倒序（新的在前）
    const jobs = await this.entityManager.find(Job, {
      order: { createdAt: 'DESC' },
    });

    // 取调度器现存任务名册
    const cronJobs = this.schedulerRegistry.getCronJobs();
    const intervalNames = this.schedulerRegistry.getIntervals();
    const timeoutNames = this.schedulerRegistry.getTimeouts();

    // 给每条数据库记录附加 running 标记：启用 AND 调度器里有同 id 的任务
    return jobs.map((job) => {
      const running =
        job.isEnabled &&
        ((job.type === 'cron' && cronJobs.has(job.id)) ||
          (job.type === 'every' && intervalNames.includes(job.id)) ||
          (job.type === 'at' && timeoutNames.includes(job.id)));

      return {
        ...job,
        running, // 前端可据此显示「运行中 / 已停止」状态
      };
    });
  }

  async addJob(
    input:
      | {
          type: 'cron';
          instruction: string;
          cron: string;
          isEnabled?: boolean;
        }
      | {
          type: 'every';
          instruction: string;
          everyMs: number;
          isEnabled?: boolean;
        }
      | {
          type: 'at';
          instruction: string;
          at: Date;
          isEnabled?: boolean;
        },
  ): Promise<Job> {
    // 用传入参数构造一条 Job 实体（create 只造对象，还没写库）
    const entity = this.entityManager.create(Job, {
      instruction: input.instruction,
      type: input.type,
      // 按 type 只填对应字段，其余置 null（同一条记录只占一个调度类型）
      cron: input.type === 'cron' ? input.cron : null,
      everyMs: input.type === 'every' ? input.everyMs : null,
      at: input.type === 'at' ? input.at : null,
      // 不传 isEnabled 时默认 true（新建即启用）；?? 表示「null/undefined 都取默认值」
      isEnabled: input.isEnabled ?? true,
      lastRun: null,
    });

    // save = 写入数据库并返回带 id 的实体
    const saved = await this.entityManager.save(Job, entity);

    // 启用状态下立即登记到调度器并开始跑
    if (saved.isEnabled) {
      this.startRuntime(saved);
    }

    return saved;
  }

  // 启用/停用某个任务。enabled 不传时「翻转」当前状态（开→关 或 关→开）。
  async toggleJob(jobId: string, enabled?: boolean): Promise<Job> {
    // 先按 id 查出这条任务；查不到就抛 404（NestJS 会转成 HTTP 404 响应）
    const job = await this.entityManager.findOne(Job, { where: { id: jobId } });
    if (!job) throw new NotFoundException(`Job not found: ${jobId}`);

    // 目标状态：传了就用传的，没传就取反
    const nextEnabled = enabled ?? !job.isEnabled;
    // 只有状态确实变了才更新数据库（避免无意义的写库）
    if (job.isEnabled !== nextEnabled) {
      job.isEnabled = nextEnabled;
      await this.entityManager.save(Job, job);
    }

    // 启用 → 登记并启动；停用 → 从调度器移除
    if (job.isEnabled) {
      this.startRuntime(job);
    } else {
      this.stopRuntime(job);
    }

    return job;
  }

  // 把某个任务登记并启动到调度器。是「增 / 启用 / 启动恢复」三处都会复用的核心方法。
  private startRuntime(job: Job): void {
    if (job.type === 'cron') {
      const cronJobs = this.schedulerRegistry.getCronJobs();
      const existing = cronJobs.get(job.id);
      // 调度器里已有同名任务 → 直接 start（避免重复 add 报错）
      if (existing) {
        existing.start();
        return;
      }

      // 没有则创建 CronJob 实例并登记、启动（createCronJob 见文件末尾）
      const runtimeJob = this.createCronJob(job);
      this.schedulerRegistry.addCronJob(job.id, runtimeJob);
      runtimeJob.start();
      return;
    }

    if (job.type === 'every') {
      const names = this.schedulerRegistry.getIntervals();
      if (names.includes(job.id)) return; // 已存在则跳过

      // 防御：间隔必须是个正数毫秒，否则无法调度
      if (typeof job.everyMs !== 'number' || job.everyMs <= 0) {
        throw new Error(`Invalid everyMs for job ${job.id}`);
      }

      // setInterval：每 everyMs 毫秒执行一次回调用。回调用 async IIFE 包起来，
      // 这样里面才能 await；void 表示「不关心这个 Promise 的返回值」。
      const ref = setInterval(() => {
        void (async () => {
          this.logger.log(`run job ${job.id}, ${job.instruction}`);
          // 先更新 lastRun（记录本次执行时间）
          await this.entityManager.update(Job, job.id, { lastRun: new Date() });

          try {
            // 真正干活：交给 AI Agent 执行指令文本
            const result = await this.jobAgentService.runJob(job.instruction);
            this.logger.log(`[job ${job.id}] ${result}`);
          } catch (e) {
            // Agent 执行出错只记日志，不让定时器崩掉
            this.logger.error(
              `job ${job.id} agent execution error: ${(e as Error).message}`,
            );
          }
        })();
      }, job.everyMs);

      // 把定时器句柄挂到调度器（key 用 job.id）
      this.schedulerRegistry.addInterval(job.id, ref);
      return;
    }

    if (job.type === 'at') {
      const names = this.schedulerRegistry.getTimeouts();
      if (names.includes(job.id)) return; // 已存在则跳过

      if (!job.at) {
        throw new Error(`Invalid at for job ${job.id}`);
      }

      // 把「目标时间」换算成「还差多少毫秒」（Math.max(0,...) 防负数——已过期的立刻触发）
      const delay = Math.max(0, job.at.getTime() - Date.now());
      const ref = setTimeout(() => {
        void (async () => {
          this.logger.log(`run job ${job.id}, ${job.instruction}`);
          // 延迟任务只跑一次：执行后把 isEnabled 置 false，并记 lastRun
          await this.entityManager.update(Job, job.id, {
            lastRun: new Date(),
            isEnabled: false, // at 类型只执行一次：执行完自动停用
          });

          try {
            const result = await this.jobAgentService.runJob(job.instruction);
            this.logger.log(`[job ${job.id}] ${result}`);
          } catch (e) {
            this.logger.error(
              `job ${job.id} agent execution error: ${(e as Error).message}`,
            );
          }

          try {
            // 跑完清理：从调度器删除这个 timeout（虽然本就只触发一次）
            this.schedulerRegistry.deleteTimeout(job.id);
          } catch {
            // ignore（任务可能已被手动停用而先删了，删第二次会报错，忽略即可）
          }
        })();
      }, delay);

      this.schedulerRegistry.addTimeout(job.id, ref);
      return;
    }
  }

  // 把某个任务从调度器移除（停用 / 删前清理时调用）。和 startRuntime 对称。
  private stopRuntime(job: Job) {
    if (job.type === 'cron') {
      // cron 类型：从调度器取出 CronJob 实例并 stop()（停止但不会销毁实例）
      const cronJobs = this.schedulerRegistry.getCronJobs();
      const runtimeJob = cronJobs.get(job.id);
      if (runtimeJob) void runtimeJob.stop();
      return;
    }

    if (job.type === 'every') {
      // 间隔任务：直接 delete（移除定时器句柄）。catch 吞掉异常——
      // 若任务本就没有登记，删除会报错，忽略即可。
      try {
        this.schedulerRegistry.deleteInterval(job.id);
      } catch {
        // ignore
      }
      return;
    }

    if (job.type === 'at') {
      try {
        this.schedulerRegistry.deleteTimeout(job.id);
      } catch {
        // ignore
      }
      return;
    }
  }

  // 按 cron 类型的 Job 创建真正的 CronJob 实例。
  // 第一个参数是 cron 表达式；第二个参数是到点时执行的回调（和 every/at 里的逻辑一致）。
  private createCronJob(job: Job) {
    const cronExpr = job.cron ?? '';
    return new CronJob(cronExpr, async () => {
      this.logger.log(`run job ${job.id}, ${job.instruction}`);
      await this.entityManager.update(Job, job.id, { lastRun: new Date() });

      try {
        const result = await this.jobAgentService.runJob(job.instruction);
        this.logger.log(`[job ${job.id}] ${result}`);
      } catch (e) {
        this.logger.error(
          `job ${job.id} agent execution error: ${(e as Error).message}`,
        );
      }
    });
  }
}
