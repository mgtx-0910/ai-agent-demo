import { Inject, Injectable } from '@nestjs/common';
import type { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { Runnable } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * 下面是最初版本的内联工具定义，只是保留做参考，不再实际使用。
 *
 * const database = {
 *   users: {
 *     '001': { id: '001', name: '张三', email: 'zhangsan@example.com', role: 'admin' },
 *     '002': { id: '002', name: '李四', email: 'lisi@example.com', role: 'user' },
 *     '003': { id: '003', name: '王五', email: 'wangwu@example.com', role: 'user' },
 *   },
 * };
 *
 * const queryUserArgsSchema = z.object({
 *   userId: z.string().describe('用户 ID，例如: 001, 002, 003'),
 * });
 *
 * type QueryUserArgs = {
 *   userId: string;
 * };
 *
 * const queryUserTool = tool(
 *   async ({ userId }: QueryUserArgs) => {
 *     const user = database.users[userId];
 *
 *     if (!user) {
 *       return `用户 ID ${userId} 不存在。可用的 ID: 001, 002, 003`;
 *     }
 *
 *     return `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}\n- 角色: ${user.role}`;
 *   },
 *   {
 *     name: 'query_user',
 *     description:
 *       '查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。',
 *     schema: queryUserArgsSchema,
 *   },
 * );
 */

/**
 * AiService — 核心 AI 对话服务
 *
 * 注入 6 个工具（query_user / send_mail / web_search / db_users_crud / time_now / cron_job）
 * 并绑定到 ChatOpenAI 模型，实现 ReAct 循环（思考 → 工具调用 → 反馈 → 再思考）。
 *
 * 提供两种对话方式：
 * - runChain(query)：普通调用，循环处理直到 AI 输出最终答案
 * - runChainStream(query)：流式调用，通过 AsyncGenerator 逐块 yield 文本
 *
 * NestJS IoC 说明：
 * - @Injectable() 标记该类为 NestJS 管理的 bean，表示"既可以被别的类注入，也可以在自己的
 *   构造函数中通过 @Inject() 注入其他依赖"
 * - 该类在 ai.module.ts 的 providers 中注册后，AiController 才能通过
 *   constructor(private aiService: AiService) 注入使用
 * - 构造函数中 7 个 @Inject('TOKEN') 是在注入其他模块/自定义 Provider 提供的依赖，
 *   NestJS 根据 token 字符串从 IoC 容器中查找对应实例
 */
@Injectable()
export class AiService {
  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;

  // 构造函数参数全部由 NestJS IoC 容器自动注入：
  // - @Inject('CHAT_MODEL') 来自 ToolModule 中自定义 Provider 注册的 ChatOpenAI 实例
  // - 6 个工具 token（QUERY_USER_TOOL / SEND_MAIL_TOOL / ...）均来自对应模块的 Provider
  constructor(
    @Inject('CHAT_MODEL') model: ChatOpenAI,
    @Inject('QUERY_USER_TOOL')
    private readonly queryUserTool: StructuredToolInterface,
    @Inject('SEND_MAIL_TOOL')
    private readonly sendMailTool: StructuredToolInterface,
    @Inject('WEB_SEARCH_TOOL')
    private readonly webSearchTool: StructuredToolInterface,
    @Inject('DB_USERS_CRUD_TOOL')
    private readonly dbUsersCrudTool: StructuredToolInterface,
    @Inject('TIME_NOW_TOOL')
    private readonly timeNowTool: StructuredToolInterface,
    @Inject('CRON_JOB_TOOL')
    private readonly cronJobTool: StructuredToolInterface,
  ) {
    this.modelWithTools = model.bindTools([
      this.queryUserTool,
      this.sendMailTool,
      this.webSearchTool,
      this.dbUsersCrudTool,
      this.timeNowTool,
      this.cronJobTool,
    ]);
  }

  /**
   * 普通对话（非流式）
   *
   * ReAct 循环流程：
   * 1. 构造 SystemMessage（工具说明 + 行为规则）+ HumanMessage（用户问题）
   * 2. 调用 modelWithTools.invoke(messages)
   * 3. 如果 AI 没有 tool_calls → 直接返回 content
   * 4. 如果有 tool_calls → 逐个执行工具，将结果作为 ToolMessage 追加到消息列表
   * 5. 回到步骤 2，直到 AI 输出最终答案
   *
   * @param query 用户提问的自然语言文本
   */
  async runChain(query: string): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        `你是一个通用任务助手，可以根据用户的目标规划步骤，并在需要时调用工具：\`query_user\` 查询或校验用户信息、\`send_mail\` 发送邮件、\`web_search\` 进行互联网搜索、\`db_users_crud\` 读写数据库 users 表、\`time_now\` 获取当前服务器时间、\`cron_job\` 创建和管理定时/周期任务（\`list\`/\`add\`/\`toggle\`），从而实现提醒、定期任务、数据同步等各种自动化需求。

定时任务类型选择规则（非常重要）：
- 用户说"X分钟/小时/天后""在某个时间点""到点提醒"（一次性）=> 用 \`cron_job\` + \`type=at\`（执行一次后自动停用），\`at\`=当前时间+X 或解析出的时间点
- 用户说"每X分钟/每小时/每天""定期/循环/一直"（重复执行）=> 用 \`cron_job\` + \`type=every\`（每次执行），\`everyMs\`=X换算成毫秒
- 用户给出 Cron 表达式或明确说"用 cron 表达式"（重复执行）=> 用 \`cron_job\` + \`type=cron\`

在调用 \`cron_job.add\` 创建任务时，需要把用户原始自然语言拆成两部分：一部分是"什么时候执行"（用来决定 type/at/everyMs/cron），另一部分是"要做什么任务本身"。\`instruction\` 字段只能填"要做什么"的那部分文本（保持原语言和原话），不能再改写、翻译或总结。

当用户请求"在未来某个时间点执行某个动作"（例如"1分钟后给我发一个笑话到邮箱"）时，本轮对话只需要使用 \`cron_job\` 设置/更新定时任务，不要在当前轮直接完成这个动作本身：不要直接调用 \`send_mail\` 给他发邮件，也不要在当前轮就真正"执行"指令，只需把要执行的动作写进 \`instruction\` 里，交给将来的定时任务去跑。

重要：\`cron_job.add\` 的 \`instruction\` 必须是自然语言任务描述，不能写成工具调用/脚本（例如禁止 \`send_mail(...)\`、\`db_users_crud(...)\`、\`web_search(...)\`）。工具调用应该由将来的 JobAgent 在执行时自行决定。

注意：像"\`1分钟后提醒我喝水\`"，时间相关信息用于计算下一次执行时间，而 \`instruction\` 应该是"提醒我喝水"；本轮不需要立刻提醒。`,
      ),
      new HumanMessage(query),
    ];

    while (true) {
      // ── invoke vs stream 对比 ──
      // invoke() 内部把整个 LLM 响应收集完毕后一次性返回，调用的代码只需 await。
      // 而 runChainStream 用了 modelWithTools.stream() + async generator + yield，
      // 由调用方（Controller 里的 from(stream).pipe(...)）订阅后 RxJS from() 内部
      // 驱动 iterator.next() 循环拉取，逐个产出 chunk 到 SSE。
      const aiMessage = await this.modelWithTools.invoke(messages);

      messages.push(aiMessage);

      const toolCalls = aiMessage.tool_calls ?? [];

      // 没有要调用的工具，直接把回答返回给调用方
      if (!toolCalls.length) {
        return aiMessage.content as string;
      }

      // 依次执行本轮需要调用的所有工具
      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'query_user') {
          const result = (await this.queryUserTool.invoke(
            toolCall.args,
          )) as unknown as string;

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'send_mail') {
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
        } else if (toolName === 'cron_job') {
          const result = (await this.cronJobTool.invoke(
            toolCall.args,
          )) as unknown as string;

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        }
      }
    }
  }

  /**
   * 流式对话（SSE）
   *
   * 与 runChain 相同的 ReAct 循环，但使用 AsyncGenerator 逐块 yield 文本：
   * 1. 使用 modelWithTools.stream() 获取流式响应
   * 2. 使用 for-await-of 消费每个 AIMessageChunk
   * 3. 只要当前轮次未出现 tool_call_chunks，就将 content 流式 yield 给前端
   * 4. 出现 tool_calls 后停止输出，执行工具，ToolMessage 加入消息列表
   * 5. 回到步骤 1，直到 AI 输出最终答案
   *
   * @param query 用户提问的自然语言文本
   */
  async *runChainStream(query: string): AsyncIterable<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        `你是一个通用任务助手，可以在需要时调用工具（如 \`query_user\`、\`db_users_crud\`、\`send_mail\`、\`web_search\`、\`time_now\`、\`cron_job\` 等）来查询或改写数据/配置，规划并执行各种任务（包括提醒、定期任务和一系列后台操作），再用结果回答用户的问题。

定时任务类型选择规则（非常重要）：
- "X分钟/小时/天后""在某个时间点""到点提醒"（一次性）=> \`cron_job.type=at\`（执行一次后自动停用）
- "每X分钟/每小时/每天""定期/循环/一直"（重复执行）=> \`cron_job.type=every\`（每次执行），\`everyMs\`=毫秒
- 给出 Cron 表达式 => \`cron_job.type=cron\``,
      ),
      new HumanMessage(query),
    ];

    while (true) {
      // 一轮对话：先让模型思考并（可能）提出工具调用
      const stream = await this.modelWithTools.stream(messages);

      let fullAIMessage: AIMessageChunk | null = null;

      for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
        fullAIMessage = fullAIMessage ? fullAIMessage.concat(chunk) : chunk;

        // 只要 fullAIMessage 里一旦出现了任何工具调用的影子
        const isToolCalling = (fullAIMessage.tool_call_chunks?.length ?? 0) > 0;

        // 只有在确定不是工具调用时，才 yield content
        if (!isToolCalling && chunk.content) {
          yield chunk.content as string;
        }
      }

      if (!fullAIMessage) {
        return;
      }

      // DeepSeek 在纯工具调用（无文本）时 content 为 null，
      // @langchain/openai 的 completions 转换器未兼容 null，会抛 flatMap 错误，
      // 这里提前归一化为空字符串
      if (fullAIMessage.content == null) {
        fullAIMessage.content = '';
      }
      messages.push(fullAIMessage);

      const toolCalls = fullAIMessage.tool_calls ?? [];

      // 没有工具调用：说明这一轮就是最终回答，已经在上面的 for-await 中流完了，可以结束
      if (!toolCalls.length) {
        return;
      }

      // 有工具调用：本轮我们不再额外输出内容，而是执行工具，生成 ToolMessage，进入下一轮
      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'query_user') {
          const result = (await this.queryUserTool.invoke(
            toolCall.args,
          )) as unknown as string;

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'send_mail') {
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
        } else if (toolName === 'cron_job') {
          const result = (await this.cronJobTool.invoke(
            toolCall.args,
          )) as unknown as string;

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        }
      }
    }
  }
}
