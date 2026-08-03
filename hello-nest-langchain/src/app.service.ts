import { Injectable } from '@nestjs/common';

/**
 * AppService — 应用根服务，提供业务逻辑
 *
 * Service（服务）是 NestJS 中封装业务逻辑的层：
 * - @Injectable() 声明该类可被注入（即可以被 DI 容器管理）
 * - 把业务逻辑从 Controller 中抽离出来，实现"关注点分离"
 * - Controller 只管路由和请求响应，Service 只管业务逻辑
 *
 * 分层架构的好处：
 * - Controller → 路由层（接收请求、返回响应）
 * - Service    → 业务逻辑层（数据处理、业务规则）
 * - 各层职责清晰，便于测试和维护
 */
@Injectable()  // 标记为可注入，Nest 会把它放入 DI 容器管理
export class AppService {
  /**
   * 简单示例方法，返回 "Hello World!"
   * 
   * 在实际项目中，这里会包含：
   * - 数据库查询
   * - 第三方 API 调用
   * - 复杂业务计算
   * - 数据校验转换
   */
  getHello(): string {
    return 'Hello World!';
  }
}
