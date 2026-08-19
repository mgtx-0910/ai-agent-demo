import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * 根级控制器。
 * 路由前缀为空，即直接挂载在应用根路径（GET /）。
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** 健康检查：GET / 返回默认问候文案。 */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
