import { forwardRef, Module } from '@nestjs/common';
import { JobService } from './job.service';
import { JobAgentService } from '../ai/job-agent.service';
import { ToolModule } from '../tool/tool.module';

/**
 * JobModule — 定时任务模块
 *
 * 使用 forwardRef(() => ToolModule) 解决循环依赖：
 * - ToolModule 导入了 JobModule（CronJobToolService 依赖 JobService）
 * - JobModule 导入了 ToolModule（JobAgentService 依赖 ToolModule 中的 tools）
 *
 * 注册 JobService（任务调度核心）+ JobAgentService（任务执行代理），
 * 并导出 JobService 供 ToolModule 使用。
 */
@Module({
  imports: [forwardRef(() => ToolModule)],
  providers: [JobService, JobAgentService],
  exports: [JobService],
})
export class JobModule {}
