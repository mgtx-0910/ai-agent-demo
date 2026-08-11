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
 * ─────────────────────────────────────────────────────────────────────
 * 1) 什么是「工具（Tool）」？
 *    这里的「工具」不是后端常说的“工具类库”，而是 AI Agent 专用的概念：
 *    把一段「函数」包装成一个 AI 可以自己决定「何时调用」的能力。
 *    例如 send_mail 工具 = 让 AI 在需要发邮件时，自己调用发邮件函数。
 *    每个工具都带有 name + description + schema（参数说明），AI 会读这些
 *    元数据来决定要不要调用、传什么参数。
 *
 * 2) 为什么有「两层」结构？
 *    - 第一层：工具服务类（如 SendMailToolService，带 @Injectable），负责
 *      用 LangChain 的 tool() 真正创建工具实例，存到 this.tool 字段。
 *    - 第二层：下面的自定义 Provider（provide 用字符串 token 如
 *      'SEND_MAIL_TOOL'），useFactory 把第一层服务的 .tool 取出来，
 *      以「字符串令牌」形式导出，供 AiModule / JobModule 用 @Inject 注入。
 *    之所以用字符串 token 而不是用类，是因为 .tool 不是类本身，是个值，
 *    类没法直接 provide，必须靠 token 当钥匙。
 *
 * 3) 自定义 Provider 三要素（NestJS 概念）：
 *    - provide：注入令牌（key），用字符串或类都行，这里统一用字符串
 *    - useFactory：一个工厂函数，返回真正要提供的实例（这里是 svc.tool）
 *    - inject：工厂函数依赖谁，NestJS 会先把这些依赖解析好再调工厂
 *
 * 4) exports：只有写进 exports 的 token，被导入本模块的模块（AiModule/
 *    JobModule）才能用 @Inject('XXX_TOOL') 拿到。没导出的拿不到。
 *
 * 5) forwardRef(() => JobModule)：解决循环依赖。ToolModule 要用
 *    JobModule 的 JobService，JobModule 又要用 ToolModule 的工具，
 *    互相引用会死锁，forwardRef 把其中一边“延迟”到运行时再解析。
 * ─────────────────────────────────────────────────────────────────────
 *
 * 集中管理所有 LangChain 工具的创建和导出。
 * 注册 LlmService + 5 个工具服务，并通过工厂函数将每个服务的 .tool 属性
 * 以字符串 token 形式导出为自定义 Provider，供 AiModule 和 JobModule 注入使用。
 *
 * 导出的 token：
 * - CHAT_MODEL：ChatOpenAI 模型实例
 * - SEND_MAIL_TOOL / WEB_SEARCH_TOOL / DB_USERS_CRUD_TOOL / TIME_NOW_TOOL / CRON_JOB_TOOL
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
