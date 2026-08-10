import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';

/**
 * AiService — AI 对话核心服务
 *
 * 这个 Service 展示了如何将 LangChain 与 NestJS 结合使用。
 *
 * LangChain 的核心概念（Chain / Pipeline）：
 * ┌──────────────┐    ┌──────────────┐    ┌─────────────────┐
 * │ PromptTemplate│ → │  ChatOpenAI   │ → │StringOutputParser│
 * │   (构造提示词) │    │ (调用大模型)   │    │  (提取纯文本)    │
 * └──────────────┘    └──────────────┘    └─────────────────┘
 *
 * .pipe() 方法将各个组件串联成一个 Runnable Chain（可运行链）：
 *   chain = prompt.pipe(model).pipe(outputParser)
 *
 * 链的输入是 { query: string }，输出是 Promise<string>
 */
@Injectable()
export class AiService {
  // 私有成员变量：存储构建好的 LangChain 链
  // Runnable 是 LangChain 的核心接口，定义了 .invoke() .stream() 等方法
  private readonly chain: Runnable<{ query: string }, string>;

  constructor(
    /**
     * @Inject('CHAT_MODEL') — 注入自定义 Provider
     *
     * 这里不是注入类，而是通过字符串 token 'CHAT_MODEL' 注入。
     * 这个 token 在 ai.module.ts 中定义，对应一个 ChatOpenAI 实例。
     *
     * 为什么不在 Service 里直接 new ChatOpenAI()？
     * - 集中管理配置（模块层统一处理 .env 读取）
     * - 测试时可以轻松替换为 mock 对象
     * - 符合"依赖倒置"原则：Service 不关心 model 是怎么创建的
     *
     * 被注释掉的另一种写法是在 Service 内直接创建 model：
     *   需要在构造函数中注入 ConfigService，然后手动 new。
     *   当前写法更好：把"创建"职责交给模块层的工厂函数。
     */
    @Inject('CHAT_MODEL') model: ChatOpenAI,
  ) {
    /**
     * 1. PromptTemplate — 提示词模板
     *
     * fromTemplate() 根据模板字符串创建 PromptTemplate 实例。
     * {query} 是占位符，运行时会替换为实际的问题文本。
     *
     * 例如输入 { query: "什么是 NestJS?" }，
     * 最终发给大模型的 prompt 是：请回答以下问题：\n\n什么是 NestJS?
     */
    const prompt = PromptTemplate.fromTemplate('请回答以下问题：\n\n{query}');

    /**
     * 2. 构建 Runnable Chain（可运行链）
     *
     * .pipe() 类似于 Unix 管道，将前后组件串联：
     *
     * prompt.pipe(model).pipe(new StringOutputParser())
     *
     * 数据流向：
     * 输入 { query: "xxx" }
     *   → PromptTemplate（填入模板，生成完整提示词）
     *   → ChatOpenAI（调用大模型 API，返回 AIMessageChunk 对象）
     *   → StringOutputParser（从 AIMessageChunk 中提取纯文本 content）
     *   → 输出纯文本字符串
     *
     * 被注释掉的代码展示了另一种写法：在 Service 内部创建 model。
     * 这违背了 DI 原则，不建议在实际项目中使用。
     */
    this.chain = prompt.pipe(model).pipe(new StringOutputParser());
  }

  /**
   * ========== 普通调用（一次性返回）==========
   *
   * .invoke() 是 LangChain 的同步等待方法：
   * - 将输入传给 chain，等待整个链路执行完毕
   * - 返回完整的生成结果
   * - 适合简短对话或不需要流式输出的场景
   *
   * @param query 用户的问题
   * @returns AI 的完整回答
   */
  async runChain(query: string): Promise<string> {
    // invoke 接收 { query } 对象，匹配 PromptTemplate 中的 {query} 占位符
    return this.chain.invoke({ query });
  }

  /**
   * ========== 流式调用（逐字返回）==========
   *
   * AsyncGenerator（异步生成器）是 ES2018 特性：
   * - 用 async function* 声明
   * - 用 yield 逐步产出数据（不阻塞，每次只产出一个值）
   * - 用 for await...of 消费生成器的输出
   *
   * .stream() 返回一个 ReadableStream：
   * - 大模型每生成一个 token，stream 就推送一个数据块
   * - for await (const chunk of stream) 逐个处理
   * - yield chunk 将每个文本片段"按需吐出"
   *
   * 效果类似于 ChatGPT 的打字机效果：文字一个字一个字地呈现
   *
   * @param query 用户的问题
   * @yields AI 回答的文本片段，每次 yield 一小段文字
   */
  async *streamChain(query: string): AsyncGenerator<string> {
    // .stream() 返回一个异步可读流
    const stream = await this.chain.stream({ query });

    // for await...of 是专门消费异步迭代器的语法
    for await (const chunk of stream) {
      // yield 将当前 chunk（一段文本）产出去
      // 调用方（Controller）会收到一个个文本片段
      yield chunk;
    }
  }
}
