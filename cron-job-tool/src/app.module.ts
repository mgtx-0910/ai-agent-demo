import { Inject, Module, OnApplicationBootstrap } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiModule } from './ai/ai.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { User } from './users/entities/user.entity';
import { Job } from './job/entities/job.entity';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { JobModule } from './job/job.module';

/**
 * AppModule — 应用根模块
 *
 * 集中管理所有子模块和第三方服务的注册：
 * - TypeORM（MySQL）：连接本地 hello 数据库，实体包括 User 和 Job
 * - ServeStaticModule：将 public/ 目录映射为静态资源
 * - ConfigModule：全局环境变量 .env 配置
 * - MailerModule：异步工厂模式，从 .env 读取邮件服务配置
 * - ScheduleModule：@nestjs/schedule 定时任务调度
 * - AiModule / UsersModule / JobModule：业务子模块
 *
 * 实现 OnApplicationBootstrap → 应用启动后自动从数据库恢复定时任务
 * （注释掉的代码为 CronJob / setInterval / setTimeout 的 SchemaRegistry 示例）
 */
@Module({
  imports: [
    // 定时任务调度模块（全局启用）
    ScheduleModule.forRoot(),
    // TypeORM MySQL 连接配置
    // synchronize: true → 自动同步实体到数据库（仅开发环境使用）
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: '192.168.174.128',
      port: 3306,
      username: 'root',
      password: '123456',
      database: 'hello',
      synchronize: true,
      connectorPackage: 'mysql',
      logging: true,
      entities: [User, Job],
    }),
    // 静态文件服务 — public/ 目录映射为 / 路径
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),
    AiModule,
    // 全局环境变量配置 — 其他模块可直接注入 ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // 邮件服务 — 从 .env 中读取 SMTP 配置
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('MAIL_HOST'),
          port: Number(configService.get<string>('MAIL_PORT')),
          secure: configService.get<string>('MAIL_SECURE') === 'true',
          auth: {
            user: configService.get<string>('MAIL_USER'),
            pass: configService.get<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from: configService.get<string>('MAIL_FROM'),
        },
      }),
    }),
    UsersModule,
    JobModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnApplicationBootstrap {
  @Inject(SchedulerRegistry)
  schedulerRegistry: SchedulerRegistry;

  /**
   * 应用启动后自动调用
   *
   * 当前为空实现，定时任务恢复逻辑已移至 JobService.onApplicationBootstrap()
   *
   * 注释掉的代码展示了 SchedulerRegistry 三种用法：
   * - addCronJob：Cron 表达式循环执行
   * - addInterval：固定间隔循环执行
   * - addTimeout：延时后执行一次
   */
  async onApplicationBootstrap() {
    // const job = new CronJob(CronExpression.EVERY_SECOND, () => {
    //   console.log('run job');
    // });
    // this.schedulerRegistry.addCronJob('job1', job);
    // job.start();
    // setTimeout(() => {
    //   this.schedulerRegistry.deleteCronJob('job1');
    // }, 5000);
    // const intervalRef = setInterval(() => {
    //   console.log('run interval job');
    // }, 1000);
    // this.schedulerRegistry.addInterval('interval1', intervalRef);
    // setTimeout(() => {
    //   this.schedulerRegistry.deleteInterval('interval1');
    // }, 5000);
    // const timeoutRef = setTimeout(() => {
    //   console.log('run timeout job');
    // }, 3000);
    // this.schedulerRegistry.addTimeout('timeout1', timeoutRef);
    // setTimeout(() => {
    //   this.schedulerRegistry.deleteTimeout('timeout1');
    // }, 5000);
  }
}
