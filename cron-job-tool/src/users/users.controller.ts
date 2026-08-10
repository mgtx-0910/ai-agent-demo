import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * UsersController — 用户 RESTful API 控制器
 *
 * 路由前缀：/users
 * 提供完整的 CRUD 接口：
 * - POST   /users     创建用户
 * - GET    /users     获取所有用户
 * - GET    /users/:id 获取单个用户
 * - PATCH  /users/:id 更新用户
 * - DELETE /users/:id 删除用户
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * POST /users
   *
   * 创建新用户，请求体需包含 name 和 email
   */
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  /**
   * GET /users
   *
   * 获取所有用户列表
   */
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  /**
   * GET /users/:id
   *
   * 按 ID 获取单个用户
   *
   * @param id 用户 ID（路由参数，自动转为 number）
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  /**
   * PATCH /users/:id
   *
   * 部分更新用户信息，只需提供要修改的字段
   *
   * @param id 用户 ID（路由参数）
   * @param updateUserDto 要更新的字段（所有字段可选）
   */
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  /**
   * DELETE /users/:id
   *
   * 按 ID 删除用户
   *
   * @param id 用户 ID（路由参数）
   */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }
}
