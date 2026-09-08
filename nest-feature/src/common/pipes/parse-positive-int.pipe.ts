import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

/**
 * ParsePositiveIntPipe：自定义参数管道 —— 把路径参数解析成"正整数"
 *
 * 为什么需要：URL 里的 :id 永远是字符串，如果直接拿去查数组，
 * "abc"、"1.5"、"-3" 这类值会产生不可预期的行为。
 * Pipe 在参数进入 Controller 前先做"转换 + 校验"。
 *
 * 用法：@Param('id', ParsePositiveIntPipe) id: number
 * （Nest 内置也有 ParseIntPipe，这里手写是为了看清校验逻辑的每一步）
 */
@Injectable()
export class ParsePositiveIntPipe implements PipeTransform<string, number> {
  transform(value: string, metadata: ArgumentMetadata): number {
    // metadata.data 是参数名（这里为 'id'），用来拼更友好的报错信息
    const parsed = Number.parseInt(value, 10);

    // 四种非法情况：非数字、≤0、带小数、字符串与原始值不完全一致（如 "1abc"、"1.5"）
    if (
      Number.isNaN(parsed) ||
      parsed <= 0 ||
      !Number.isInteger(parsed) ||
      String(parsed) !== value
    ) {
      throw new BadRequestException(
        `参数 ${metadata.data ?? 'id'} 必须是正整数，当前值: ${value}`,
      );
    }

    return parsed;
  }
}
