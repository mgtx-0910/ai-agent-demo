import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

/**
 * LlmService — LLM 模型创建服务
 *
 * 从 ConfigService（.env）读取模型配置，通过 getModel() 创建并返回 ChatOpenAI 实例。
 * 配置项：
 * - MODEL_NAME：模型名称（默认 gpt-4o-mini）
 * - OPENAI_API_KEY：API 密钥
 * - OPENAI_BASE_URL：API 端点地址（支持 OpenAI 兼容代理，如阿里百炼）
 */
@Injectable()
export class LlmService {
  @Inject(ConfigService)
  private readonly configService: ConfigService;

  /**
   * 创建 ChatOpenAI 模型实例
   *
   * 使用 .env 中的 MODEL_NAME、OPENAI_API_KEY、OPENAI_BASE_URL 配置，
   * 未配置的项使用兜底默认值。
   */
  getModel(): ChatOpenAI {
    const model = this.configService.get<string>('MODEL_NAME') ?? 'gpt-4o-mini';
    const apiKey = this.configService.get<string>('OPENAI_API_KEY') ?? '';
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    return new ChatOpenAI({
      model,
      apiKey,
      configuration: { baseURL },
    });
  }
}
