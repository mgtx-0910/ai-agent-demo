/**
 * 根服务
 *
 * 核心概念：
 * - 提供基础的 getHello 方法，返回问候文本
 * - 被 AppController 注入使用
 *
 * @see app.controller.ts — 调用本服务的控制器
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
