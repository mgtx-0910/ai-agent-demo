import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

@Injectable()
export class LlmService {
  @Inject(ConfigService)
  private readonly configService: ConfigService;

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
