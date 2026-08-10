import { Injectable } from '@nestjs/common';

/**
 * AppService — 根服务
 *
 * 最简单的 NestJS Service，只提供一个返回 "Hello World!" 的方法，
 * 用于验证应用是否正常启动。
 */
@Injectable()
export class AppService {
  /**
   * 返回问候字符串，供 AppController 调用
   */
  getHello(): string {
    return 'Hello World!';
  }
}
