import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * 根控制器
 *
 * 只保留 Nest 脚手架自带的 Hello World：
 * 作为最轻量的「进程是否还活着」探针（不查库、不依赖任何外部组件）。
 * 业务接口都在 DocumentController 中。
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** GET / —— 存活探针，恒返回 Hello World! */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
