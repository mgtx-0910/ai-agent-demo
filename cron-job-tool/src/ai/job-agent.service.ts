import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { Runnable } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * JobAgentService — 后台任务执行代理
 *
 * 当定时任务触发时，JobService 调用本服务的 runJob(instruction) 来执行任务。
 * 与 AiService 的区别：
 * - AiService 面向用户，需要自然语言回复
 * - JobAgentService 面向系统，只关注任务是否完成 + 返回结果
 *
 * 绑定 4 个工具（send_mail / web_search / db_users_crud / time_now），
 * 不包含 cron_job（防止递归创建任务）和 query_user（由内存 UserService 提供）。
 */
@Injectable()
export class JobAgentService {
  private readonly logger = new Logger(JobAgentService.name);
  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;

  constructor(
    @Inject('CHAT_MODEL') model: ChatOpenAI,
    @Inject('SEND_MAIL_TOOL')
    private readonly sendMailTool: StructuredToolInterface,
    @Inject('WEB_SEARCH_TOOL')
    private readonly webSearchTool: StructuredToolInterface,
    @Inject('DB_USERS_CRUD_TOOL')
    private readonly dbUsersCrudTool: StructuredToolInterface,
    @Inject('TIME_NOW_TOOL')
    private readonly timeNowTool: StructuredToolInterface,
  ) {
    this.modelWithTools = model.bindTools([
      this.sendMailTool,
      this.webSearchTool,
      this.dbUsersCrudTool,
      this.timeNowTool,
    ]);
  }

  /**
   * 执行定时任务的指令
   *
   * ReAct 循环：SystemMessage 提示 AI 是后台代理 → HumanMessage(instruction)
   * → 调用 modelWithTools → 执行工具 → ToolMessage 反馈 → 循环直到完成
   *
   * @param instruction 定时任务中存储的自然语言指令文本
   * @returns 执行结果的文本描述
   */
  async runJob(instruction: string): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        '你是一个用于执行后台任务的智能代理。你会根据给定的任务指令，必要时调用工具（如 db_users_crud、send_mail、web_search、time_now 等）来查询或改写数据，然后给出清晰的步骤和结果说明。',
      ),
      new HumanMessage(instruction),
    ];

    while (true) {
      const aiMessage = await this.modelWithTools.invoke(messages);

      messages.push(aiMessage);

      const toolCalls = aiMessage.tool_calls ?? [];

      // 没有工具调用 → 任务完成，返回结果
      if (!toolCalls.length) {
        const content = aiMessage.content;
        return typeof content === 'string' ? content : JSON.stringify(content);
      }

      // 执行工具调用
      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'send_mail') {
          const result = (await this.sendMailTool.invoke(
            toolCall.args,
          )) as unknown as string;
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'web_search') {
          const result = (await this.webSearchTool.invoke(
            toolCall.args,
          )) as unknown as string;
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'db_users_crud') {
          const result = (await this.dbUsersCrudTool.invoke(
            toolCall.args,
          )) as unknown as string;
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'time_now') {
          const result = (await this.timeNowTool.invoke(
            {},
          )) as unknown as string;
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else {
          this.logger.warn(`未知工具调用: ${toolName}`);
        }
      }
    }
  }
}
