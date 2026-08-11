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
 * - ConfigModule（必须最先）：全局环境变量 .env 配置，后续模块通过 ConfigService 注入
 * - TypeORM（MySQL）：异步工厂模式，从 .env 读取数据库连接参数
 * - ServeStaticModule：将 public/ 目录映射为静态资源
 * - MailerModule：异步工厂模式，从 .env 读取邮件服务配置
 * - ScheduleModule：@nestjs/schedule 定时任务调度
 * - AiModule / UsersModule / JobModule：业务子模块
 *
 * 实现 OnApplicationBootstrap → 应用启动后自动从数据库恢复定时任务
 * （注释掉的代码为 CronJob / setInterval / setTimeout 的 SchemaRegistry 示例）
 */
@Module({
  imports: [
    // 全局环境变量配置 — 必须最先加载，后续模块通过 ConfigService 注入
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // 定时任务调度模块（全局启用）
    ScheduleModule.forRoot(),
    // TypeORM MySQL 连接 — 从 .env 读取数据库参数
    // synchronize: true → 自动同步实体到数据库（仅开发环境使用）
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: configService.get<string>('DB_TYPE', 'mysql') as 'mysql',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: Number(configService.get<string>('DB_PORT', '3306')),
        username: configService.get<string>('DB_USERNAME', 'root'),
        password: configService.get<string>('DB_PASSWORD', 'admin'),
        database: configService.get<string>('DB_DATABASE', 'hello'),
        synchronize:
          configService.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
        connectorPackage: configService.get<string>(
          'DB_CONNECTOR',
          'mysql2',
        ) as 'mysql2',
        logging: configService.get<string>('DB_LOGGING', 'true') === 'true',
        entities: [User, Job],
      }),
    }),
    // 静态文件服务 — public/ 目录映射为 / 路径
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),
    AiModule,
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
