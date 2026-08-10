import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

/**
 * AppController 单元测试
 *
 * NestJS 测试的核心概念：
 * 1. Test.createTestingModule() — 创建一个独立的测试模块
 *    类似 AppModule，但只在测试中使用，不会启动真正的 HTTP 服务器
 *
 * 2. .compile() — 编译测试模块，完成 DI 依赖注入的实例化
 *
 * 3. app.get<T>(ClassName) — 从测试模块的 DI 容器中获取某个类的实例
 *    类似于生产代码中的 @Inject()
 */
describe('AppController', () => {
  let appController: AppController;

  /**
   * beforeEach — Jest 的钩子函数
   * 在每个测试用例（it）执行之前运行，确保每个测试都有干净的初始状态
   */
  beforeEach(async () => {
    // 创建测试模块：手动声明需要测试的 controller 和它依赖的 provider
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController], // 要测试的控制器
      providers: [AppService], // 控制器依赖的服务（真实的或 mock 的）
    }).compile();

    // 从测试模块的 DI 容器中取出 AppController 实例
    // 泛型 <AppController> 告诉 TS 返回值的类型
    appController = app.get<AppController>(AppController);
  });

  /**
   * describe 可以嵌套，用于组织相关的测试用例
   * 这里 "root" 表示测试根路由相关的逻辑
   */
  describe('root', () => {
    /**
     * it — Jest 的单个测试用例
     * 第一个参数是测试描述（按"should xxx"的格式命名）
     * 第二个参数是测试函数
     */
    it('should return "Hello World!"', () => {
      // expect(实际值).toBe(期望值) — Jest 断言
      // 如果实际值和期望值不一致，测试就会失败
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
