import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

/**
 * AppController — 根控制器，处理应用根路径的 HTTP 请求
 *
 * 控制器（Controller）的核心职责：
 * - 接收 HTTP 请求（GET/POST/PUT/DELETE 等）
 * - 调用对应的 Service 处理业务逻辑
 * - 返回 HTTP 响应
 *
 * NestJS 控制器的几个关键概念：
 * 1. @Controller()       — 声明这是一个控制器类
 * 2. @Get()              — 装饰器，将方法映射为 GET 请求处理器
 * 3. 构造函数注入        — 通过 constructor 参数声明需要注入的服务
 *    private readonly 会自动将参数变为类成员变量，无需手动 this.xxx = xxx
 */
@ApiTags('根')
@Controller() // 没有参数 = 匹配根路径 "/"
export class AppController {
  /**
   * 构造函数注入（Constructor-based DI）
   *
   * Nest 的 DI 容器会在实例化 Controller 时自动：
   * 1. 查找 AppService 的实例（从 AppModule 的 providers 中）
   * 2. 注入到构造函数的 appService 参数中
   *
   * private readonly 是 TypeScript 的简写语法：
   * - private：类外部不可访问
   * - readonly：只能在构造函数中赋值，之后不可修改
   * - 省略了显式的成员声明，编译器自动生成 this.appService
   */
  constructor(private readonly appService: AppService) {}

  /**
   * @Get() 将 getHello() 映射为 GET / 请求的处理器
   *
   * 当用户访问 http://localhost:3000/ 时：
   * 1. Nest 路由到 AppController.getHello()
   * 2. 调用 appService.getHello() 获取返回值
   * 3. 返回 "Hello World!" 字符串作为 HTTP 响应体
   *
   * Nest 会自动将返回值序列化为 HTTP 响应：
   * - 返回 string → text/html 响应
   * - 返回 object → application/json 响应
   */
  @ApiOperation({ summary: '获取 Hello World', description: '返回 Hello World 字符串' })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
