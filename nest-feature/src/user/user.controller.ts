import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/api-response.interface';
import { ParseAgePipe } from '../common/pipes/parse-age.pipe';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';

/**
 * 用户控制器：标准 RESTful CRUD + Nest 三大特性演示（Pipe / Guard / 自定义装饰器）
 *
 * 本文件是"看一个 Controller 能叠多少 Nest 特性"的样板：
 *  - Pipe：参数进入 Controller 前先被转换 / 校验
 *  - Guard：在进入路由处理前先做鉴权 / 授权
 *  - 自定义参数装饰器：把 request.user 优雅地"抽"成方法参数
 */
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /** POST /user —— 创建用户（无鉴权，方便演示） */
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  /** GET /user —— 查询全部（无鉴权） */
  @Get()
  findAll() {
    return this.userService.findAll();
  }

  /**
   * GET /user/age-demo?age=25 —— 自定义 Pipe 演示
   * 查询参数本质是字符串，ParseAgePipe 会把 "25" 转成数字并校验 0~150
   */
  @Get('age-demo')
  ageDemo(@Query('age', ParseAgePipe) age: number) {
    return { age, type: typeof age };
  }

  /**
   * GET /user/:id —— 受保护的查询接口
   *  - ParsePositiveIntPipe：路径参数必须是正整数（路由顺序上"age-demo"
   *    要放在 ':id' 之前，否则会被 :id 捕获）
   *  - @UseGuards(AuthGuard)：没有 / 无效 Token 一律 401
   *  - @CurrentUser()：装饰器取出 Guard 放进 request.user 的登录用户
   *  - 鉴权授权规则写在 Guard 里：普通用户只能查自己，管理员可查任意
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  findOne(
    @Param('id', ParsePositiveIntPipe) id: number,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return {
      ...this.userService.findOne(id),
      requestedBy: currentUser.username,
    };
  }

  /** PATCH /user/:id —— 受保护的部分更新接口，同样做身份 / 越权校验 */
  @Patch(':id')
  @UseGuards(AuthGuard)
  update(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return {
      ...this.userService.update(id, updateUserDto),
      updatedBy: currentUser.username,
    };
  }

  /** DELETE /user/:id —— 删除用户（示例特意不加 Guard，展示 Pipe 独立拦截非法 id） */
  @Delete(':id')
  remove(@Param('id', ParsePositiveIntPipe) id: number) {
    return this.userService.remove(id);
  }
}
