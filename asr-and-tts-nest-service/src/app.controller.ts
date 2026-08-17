/**
 * 根控制器
 *
 * 核心概念：
 * - 提供默认路由 GET /，返回问候文本
 * - 作为最小可运行示例，验证应用启动正常
 *
 * @see app.service.ts — 提供问候文本的服务
 */
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {} // 注入根服务

  @Get()
  getHello(): string {
    return this.appService.getHello(); // 委托根服务返回问候文本
  }
}
