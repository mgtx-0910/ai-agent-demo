import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * 根控制器：处理应用根路径的请求
 * 通过构造函数注入 AppService（Nest 的依赖注入会自动完成实例化）
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** GET / —— 返回 Hello World，用于快速验证服务已启动 */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
