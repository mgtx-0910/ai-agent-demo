import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, AIMessageChunk, createAgent, HumanMessage, SystemMessage, ToolMessage } from 'langchain';
import { UIMessage } from 'ai';
import { toBaseMessages, toUIMessageStream } from '@ai-sdk/langchain';

/**
 * AI 对话核心服务。
 * 基于 LangChain createAgent 构建一个「工具型 Agent」：
 *  - 注入的模型负责理解对话与决定是否调用工具
 *  - web_search / send_mail 两个工具由 AiModule 通过 DI token 注入
 * 职责：把 Vercel AI SDK 的 UIMessage 转换为 LangChain 消息，驱动 agent
 *       流式执行，再把 LangChain 的流式输出转回 AI SDK 的 UIMessageStream。
 */
@Injectable()
export class AiService {
  /** 工具型 Agent 实例（构造时由 createAgent 创建） */
  private readonly agent: ReturnType<typeof createAgent>;

  constructor(
    @Inject('WEB_SEARCH_TOOL') private readonly webSearchTool: any, // 联网搜索工具
    @Inject('SEND_MAIL_TOOL') private readonly sendMailTool: any, // 发送邮件工具
    @Inject('CHAT_MODEL') model: ChatOpenAI // 底层对话模型（OpenAI 兼容协议）
  ) {
    // 创建 agent：绑定模型 + 工具 + 系统提示词
    this.agent = createAgent({
        model,
        tools: [this.webSearchTool, this.sendMailTool],
        systemPrompt:
          '你是 AI 助手，需要最新信息、事实核查或联网信息时，请使用 web_search 工具搜索后再作答。发送邮件用 send_mail 工具',
      });
  }

  /**
   * 流式对话入口。
   * @param messages AI SDK 的 UIMessage[]（前端传入，含多轮历史）
   * @returns AI SDK 的 UIMessageStream，可被 pipeUIMessageStreamToResponse 直接消费
   */
  async stream(messages: UIMessage[]) {
    // 1. UIMessage[] → LangChain BaseMessage[]（协议转换）
    const lcMessages = await toBaseMessages(messages);
    // 2. 驱动 agent 流式执行：messages 模式可拿到逐 token 增量，values 模式可拿到完整中间状态
    const lgStream = await this.agent.stream(
      { messages: lcMessages },
      {
        streamMode: ['messages', 'values'], // 同时产出消息增量与 agent 完整状态
        recursionLimit: 30, // 限制工具调用递归深度，防止死循环
      },
    );

    // 3. LangChain 流 → AI SDK UIMessageStream（协议转换回给控制器）
    return toUIMessageStream(lgStream as AsyncIterable<AIMessageChunk>);
  }
}
