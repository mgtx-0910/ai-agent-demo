import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import z from 'zod';
import { MailerService } from '@nestjs-modules/mailer';

/**
 * AI 对话模块。
 * 集中装配 Agent 所需的全部依赖：
 *  - CHAT_MODEL：OpenAI 兼容对话模型（模型名/Key/BaseURL 均来自 .env）
 *  - WEB_SEARCH_TOOL：Bocha 联网搜索工具（LangChain tool 封装）
 *  - SEND_MAIL_TOOL：邮件发送工具（依赖全局 MailerModule 的 MailerService）
 */
@Module({
  controllers: [AiController],
  providers: [AiService,
    // ---- CHAT_MODEL：OpenAI 兼容的聊天模型实例 ----
    {
      provide: 'CHAT_MODEL',
      useFactory: (configService: ConfigService) => {
        return new ChatOpenAI({
          model: configService.get('MODEL_NAME'), // 模型名，如 gpt-4o / deepseek-chat 等
          apiKey: configService.get('OPENAI_API_KEY'), // API Key
          configuration: {
            baseURL: configService.get('OPENAI_BASE_URL'), // 兼容端点地址（可指向任意 OpenAI 兼容服务）
          },
        });
      },
      inject: [ConfigService],
    },
    // ---- WEB_SEARCH_TOOL：Bocha 联网搜索工具 ----
    {
      provide: 'WEB_SEARCH_TOOL',
      useFactory: (configService: ConfigService) => {
        // 工具入参的 zod schema：会注入到模型提示中用于生成结构化调用参数
        const webSearchArgsSchema = z.object({
          query: z
            .string()
            .min(1)
            .describe('搜索关键词，例如：公司年报、某个事件等'),
          count: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe('返回的搜索结果数量，默认 10 条'),
        });
    
        return tool(
          // 工具执行体：调用 Bocha Web Search API 并返回格式化文本给模型
          async ({ query, count }: { query: string; count?: number }) => {
            const apiKey = configService.get<string>('BOCHA_API_KEY');
            if (!apiKey) {
              return 'Bocha Web Search 的 API Key 未配置（环境变量 BOCHA_API_KEY），请先在服务端配置后再重试。';
            }
    
            const url = 'https://api.bochaai.com/v1/web-search';
            const body = {
              query,
              freshness: 'noLimit', // 不限时效
              summary: true, // 返回摘要
              count: count ?? 10, // 默认返回 10 条
            };
    
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            });
    
            // HTTP 非 2xx：把状态码与错误文本返回给模型（模型会如实转述给用户）
            if (!response.ok) {
              const errorText = await response.text();
              return `搜索 API 请求失败，状态码: ${response.status}, 错误信息: ${errorText}`;
            }
    
            let json: any;
            try {
              json = await response.json();
            } catch (e) {
              return `搜索 API 请求失败，原因是：搜索结果解析失败 ${(e as Error).message}`;
            }
    
            try {
              // Bocha 业务码判断：code 200 且有 data 才算成功
              if (json.code !== 200 || !json.data) {
                return `搜索 API 请求失败，原因是: ${json.msg ?? '未知错误'}`;
              }
    
              const webpages = json.data.webPages?.value ?? [];
              if (!webpages.length) {
                return '未找到相关结果。';
              }
    
              // 把网页列表格式化成带编号的纯文本，便于模型引用与阅读
              const formatted = webpages
                .map(
                  (page: any, idx: number) =>
                    `引用: ${idx + 1}
标题: ${page.name}
URL: ${page.url}
摘要: ${page.summary}
网站名称: ${page.siteName}
网站图标: ${page.siteIcon}
发布时间: ${page.dateLastCrawled}`,
                )
                .join('\n\n');
    
              return formatted;
            } catch (e) {
              return `搜索 API 请求失败，原因是：搜索结果解析失败 ${(e as Error).message}`;
            }
          },
          {
            name: 'web_search', // 工具名（模型调用时的函数名）
            description:
              '使用 Bocha Web Search API 搜索互联网网页。输入为搜索关键词（可选 count 指定结果数量），返回包含标题、URL、摘要、网站名称、图标和时间等信息的结果列表。',
            schema: webSearchArgsSchema, // 参数 schema
          },
        );
      },
      inject: [ConfigService],
    },
    // ---- SEND_MAIL_TOOL：邮件发送工具 ----
    {
      provide: 'SEND_MAIL_TOOL',
      // 注入 MailerService（来自全局 MailerModule）与 ConfigService
      useFactory: (mailerService: MailerService, configService: ConfigService) => {
        // 工具入参 schema：收件人（校验邮箱格式）、主题、可选文本/HTML 内容
        const sendMailArgsSchema = z.object({
          to: z
            .email()
            .describe('收件人邮箱地址，例如：someone@example.com'),
          subject: z.string().describe('邮件主题'),
          text: z.string().optional().describe('纯文本内容，可选'),
          html: z.string().optional().describe('HTML 内容，可选'),
        });
    
        return tool(
          // 工具执行体：委托 NestJS MailerService 实际发送邮件
          async ({to, subject, text, html}: {
            to: string;
            subject: string;
            text?: string;
            html?: string;
          }) => {
            // 发件人默认取 .env 的 MAIL_FROM
            const fallbackFrom =
              configService.get<string>('MAIL_FROM')
    
            await mailerService.sendMail({
              to,
              subject,
              // text/html 为空时提供兜底占位文案，避免邮件正文为空
              text: text ?? '（无文本内容）',
              html: html ?? `<p>${text ?? '（无 HTML 内容）'}</p>`,
              from: fallbackFrom,
            });
    
            // 把成功结果以文本形式返回给模型，用于向用户确认
            return `邮件已发送到 ${to}，主题为「${subject}」`;
          },
          {
            name: 'send_mail', // 工具名
            description:
              '发送电子邮件。需要提供收件人邮箱、主题，可选文本内容和 HTML 内容。',
            schema: sendMailArgsSchema, // 参数 schema
          },
        );
      },
      inject: [MailerService, ConfigService],
    },
  ],
})
export class AiModule {}
