import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { tool, StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * SendMailToolService — 邮件发送工具
 *
 * 封装 LangChain StructuredTool，底层通过 @nestjs-modules/mailer 的 MailerService
 * 发送邮件。AI Agent 调用 send_mail 工具时自动触发。
 *
 * 参数：
 * - to：收件人邮箱
 * - subject：邮件主题
 * - text / html：邮件内容（可选，二选一或都填）
 *
 * 发件人地址从 .env 的 MAIL_FROM 读取，作为兜底。
 */
@Injectable()
export class SendMailToolService {
  readonly tool: StructuredTool;

  @Inject(MailerService)
  private readonly mailerService: MailerService;

  @Inject(ConfigService)
  private readonly configService: ConfigService;

  constructor() {
    const sendMailArgsSchema = z.object({
      to: z.email().describe('收件人邮箱地址，例如：someone@example.com'),
      subject: z.string().describe('邮件主题'),
      text: z.string().optional().describe('纯文本内容，可选'),
      html: z.string().optional().describe('HTML 内容，可选'),
    });

    this.tool = tool(
      async ({
        to,
        subject,
        text,
        html,
      }: {
        to: string;
        subject: string;
        text?: string;
        html?: string;
      }) => {
        const fallbackFrom = this.configService.get<string>('MAIL_FROM');

        await this.mailerService.sendMail({
          to,
          subject,
          text: text ?? '（无文本内容）',
          html: html ?? `<p>${text ?? '（无 HTML 内容）'}</p>`,
          from: fallbackFrom,
        });

        return `邮件已发送到 ${to}，主题为「${subject}」`;
      },
      {
        name: 'send_mail',
        description:
          '发送电子邮件。需要提供收件人邮箱、主题，可选文本内容和 HTML 内容。',
        schema: sendMailArgsSchema,
      },
    );
  }
}
