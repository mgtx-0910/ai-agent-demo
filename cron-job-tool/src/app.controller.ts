import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * AppController — 根路由控制器
 *
 * @Controller() 不带参数表示匹配根路径 "/"
 *
 * GET / → getHello() → "Hello World!"
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * GET / 的请求处理器
   *
   * 访问 http://localhost:3000/ 时直接返回 "Hello World!"
   */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
