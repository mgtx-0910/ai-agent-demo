import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

/**
 * ParseAgePipe：自定义参数管道 —— 校验"年龄"查询参数
 *
 * 业务规则：必须非空、能转成数字、且在合理年龄范围 0~150 内。
 * 与 ParsePositiveIntPipe 对比可见：Pipe 本质就是
 *   transform(value: string, metadata) -> number
 * 的具体业务校验，参数语义不同就写不同的 Pipe。
 *
 * 用法：@Query('age', ParseAgePipe) age: number
 */
@Injectable()
export class ParseAgePipe implements PipeTransform<string, number> {
  transform(value: string, metadata: ArgumentMetadata): number {
    // 空值校验：没传 / 传了空串都拦截
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException(
        `参数 ${metadata.data ?? 'age'} 不能为空`,
      );
    }

    // Number('25') -> 25；注意 Number 会把空串转成 0，所以上面先挡空值
    const parsed = Number(value);

    // NaN（如 'abc'）与 Infinity 都视为非法数字
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      throw new BadRequestException(
        `参数 ${metadata.data ?? 'age'} 必须是有效数字，当前值: ${value}`,
      );
    }

    // 范围校验：年龄必须在合理区间
    if (parsed < 0 || parsed > 150) {
      throw new BadRequestException('年龄必须在 0 ~ 150 之间');
    }

    return parsed;
  }
}
