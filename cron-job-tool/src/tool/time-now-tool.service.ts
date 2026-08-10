import { Injectable } from '@nestjs/common';
import { tool, StructuredTool } from '@langchain/core/tools';

/**
 * TimeNowToolService — 获取服务器时间工具
 *
 * 封装 LangChain StructuredTool，无需参数，
 * 返回 ISO 时间字符串（iso）和毫秒级时间戳（timestamp）。
 * 同步操作，非常轻量。
 */
@Injectable()
export class TimeNowToolService {
  readonly tool: StructuredTool;

  constructor() {
    this.tool = tool(
      (): { iso: string; timestamp: number } => {
        const now = new Date();
        return {
          iso: now.toISOString(),
          timestamp: now.getTime(),
        };
      },
      {
        name: 'time_now',
        description:
          '获取当前服务器时间，返回 ISO 字符串（iso）和毫秒级时间戳（timestamp）。',
      },
    );
  }
}
