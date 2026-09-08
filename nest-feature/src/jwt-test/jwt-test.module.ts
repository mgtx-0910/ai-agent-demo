import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtTestController } from './jwt-test.controller';
import { JwtTestService } from './jwt-test.service';

/**
 * jwt-test 模块：普通（非全局）功能模块
 *
 * 注意：JwtModule 已在根模块 AppModule 里通过 register({ global: true })
 * 全局注册，因此这里不再重复 import，直接注入 JwtService 即可。
 * 下方保留了一段被注释掉的局部 register 写法作对照 ——
 * 如果根模块没有全局注册，就需要在此处恢复这段配置。
 */
@Module({
  imports: [
    // JwtModule.register({
    //   secret: 'jwt-test-secret-key',
    //   signOptions: { expiresIn: '1h' },
    // }),
  ],
  controllers: [JwtTestController],
  providers: [JwtTestService],
})
export class JwtTestModule {}
