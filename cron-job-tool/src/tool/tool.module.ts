import { forwardRef, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { LlmService } from './llm.service';
import { SendMailToolService } from './send-mail-tool.service';
import { WebSearchToolService } from './web-search-tool.service';
import { DbUsersCrudToolService } from './db-users-crud-tool.service';
import { TimeNowToolService } from './time-now-tool.service';
import { CronJobToolService } from './cron-job-tool.service';
import { JobModule } from '../job/job.module';

/**
 * ToolModule — 工具总模块
 *
 * 集中管理所有 LangChain 工具的创建和导出。
 * 注册 LlmService + 5 个工具服务，并通过工厂函数将每个服务的 .tool 属性
 * 以字符串 token 形式导出为自定义 Provider，供 AiModule 和 JobModule 注入使用。
 *
 * 导出的 token：
 * - CHAT_MODEL：ChatOpenAI 模型实例
 * - SEND_MAIL_TOOL / WEB_SEARCH_TOOL / DB_USERS_CRUD_TOOL / TIME_NOW_TOOL / CRON_JOB_TOOL
 *
 * forwardRef(() => JobModule) 解决与 JobModule 的循环依赖。
 */
@Module({
  imports: [UsersModule, forwardRef(() => JobModule)],
  providers: [
    LlmService, // LLM 模型创建服务
    SendMailToolService, // 邮件发送工具
    WebSearchToolService, // 网络搜索工具
    DbUsersCrudToolService, // 数据库用户 CRUD 工具
    TimeNowToolService, // 获取服务器时间工具
    CronJobToolService, // 定时任务管理工具
    {
      provide: 'CHAT_MODEL',
      useFactory: (llmService: LlmService) => llmService.getModel(),
      inject: [LlmService],
    },
    {
      provide: 'SEND_MAIL_TOOL',
      useFactory: (svc: SendMailToolService) => svc.tool,
      inject: [SendMailToolService],
    },
    {
      provide: 'WEB_SEARCH_TOOL',
      useFactory: (svc: WebSearchToolService) => svc.tool,
      inject: [WebSearchToolService],
    },
    {
      provide: 'DB_USERS_CRUD_TOOL',
      useFactory: (svc: DbUsersCrudToolService) => svc.tool,
      inject: [DbUsersCrudToolService],
    },
    {
      provide: 'TIME_NOW_TOOL',
      useFactory: (svc: TimeNowToolService) => svc.tool,
      inject: [TimeNowToolService],
    },
    {
      provide: 'CRON_JOB_TOOL',
      useFactory: (svc: CronJobToolService) => svc.tool,
      inject: [CronJobToolService],
    },
  ],
  exports: [
    'CHAT_MODEL',
    'SEND_MAIL_TOOL',
    'WEB_SEARCH_TOOL',
    'DB_USERS_CRUD_TOOL',
    'TIME_NOW_TOOL',
    'CRON_JOB_TOOL',
  ],
})
export class ToolModule {}
