import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtTestModule } from './jwt-test/jwt-test.module';
import { UserModule } from './user/user.module';
import { JwtModule } from '@nestjs/jwt';

/**
 * 根模块：整个应用的组装点
 * - imports：要加载哪些子模块 / 第三方模块
 * - controllers：本模块直属控制器
 * - providers：本模块直属服务
 */
@Module({
  imports: [
    // 业务模块：AuthModule 是 @Global 全局模块，UserModule / JwtTestModule 为普通功能模块
    AuthModule,
    UserModule,
    JwtTestModule,
    // 在根模块全局注册 JwtModule：配好 secret 与过期时间后，
    // 任何模块里都能直接注入 JwtService，无需各自再 register 一次
    JwtModule.register({
      global: true,
      secret: 'jwt-test-secret-key',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
