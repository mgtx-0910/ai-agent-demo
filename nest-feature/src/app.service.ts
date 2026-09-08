import { Injectable } from '@nestjs/common';

/**
 * 根服务：Controller 与具体业务逻辑解耦
 * （本示例无业务，仅作为 DI 注入链路的最小演示）
 */
@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
