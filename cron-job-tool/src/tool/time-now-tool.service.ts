import { Injectable } from '@nestjs/common';
import { tool, StructuredTool } from '@langchain/core/tools';

/**
 * TimeNowToolService — 获取服务器时间工具（推荐先读这个文件，最易懂）
 *
 * ─────────────────────────────────────────────────────────────────────
 * 一个 LangChain「工具」由三部分组成（后面所有 *-tool.service.ts 都一样）：
 *   1) tool(fn, { name, description, schema })
 *      - fn：工具真正执行的代码（AI 调用时运行的就是它）
 *      - name：工具名字，AI 用它来「点名」要调用哪个工具
 *      - description：给 AI 看的功能描述（最重要！AI 全靠这段中文
 *        判断「该不该用这个工具」。描述写不清楚，AI 就不会调用）
 *      - schema：用 zod 描述的参数结构，告诉 AI 该传哪些参数、什么类型
 *   2) @Injectable()：让 NestJS 把这个类当「可注入的 bean」管理
 *   3) 类里 this.tool 存好创建好的工具实例，由 ToolModule 导出供 AI 使用
 *
 * 这个工具最简单：无需参数，返回 ISO 时间字符串（iso）和毫秒级时间戳（timestamp）。
 * 同步操作，非常轻量。
 * ─────────────────────────────────────────────────────────────────────
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
