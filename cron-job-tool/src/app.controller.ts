import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

/**
 * AppController — 根路由控制器
 *
 * @Controller() 不带参数表示匹配根路径 "/"
 *
 * GET / → getHello() → "Hello World!"
 */
@ApiTags('根')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * GET / 的请求处理器
   *
   * 访问 http://localhost:3000/ 时直接返回 "Hello World!"
   */
  @ApiOperation({ summary: '获取 Hello World', description: '返回 Hello World 字符串' })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
