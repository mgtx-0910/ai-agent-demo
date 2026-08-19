import { Injectable } from '@nestjs/common';

/**
 * 根级业务服务（示例）。
 * 仅提供默认的健康检查文案，真实业务逻辑位于 ai 模块。
 */
@Injectable()
export class AppService {
  /** 返回根路径的问候文案。 */
  getHello(): string {
    return 'Hello World!';
  }
}
