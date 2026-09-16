import { Injectable } from '@nestjs/common';

/**
 * 根服务
 *
 * 目前只有探针用的静态文案；被 AppController 注入。
 * 真实业务逻辑放在 DocumentService。
 */
@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
