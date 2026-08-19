import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { MailerModule } from '@nestjs-modules/mailer';

/**
 * 应用根模块。
 * 引入三块能力：
 *  1. ConfigModule：全局配置（.env），任何模块可通过 ConfigService 读取环境变量；
 *  2. MailerModule：邮件发送能力，配置项全部来自 .env（MAIL_HOST/PORT/SECURE/USER/PASS/FROM）；
 *  3. AiModule：AI 对话核心业务模块。
 */
@Module({
  imports: [
    // 全局配置模块：isGlobal 使其无需显式导入即可被注入
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // 邮件模块（异步初始化，等 ConfigService 就绪后用配置构造 SMTP 传输参数）
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('MAIL_HOST'), // SMTP 服务器地址
          port: Number(configService.get<string>('MAIL_PORT')), // SMTP 端口（465/587 等）
          secure: configService.get<string>('MAIL_SECURE') === 'true', // true 表示使用 SSL/TLS
          auth: {
            user: configService.get<string>('MAIL_USER'), // SMTP 登录账号
            pass: configService.get<string>('MAIL_PASS'), // SMTP 授权码/密码
          },
        },
        defaults: {
          from: configService.get<string>('MAIL_FROM'), // 默认发件人
        },
      }),
    }),
    AiModule, // AI 对话模块
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

