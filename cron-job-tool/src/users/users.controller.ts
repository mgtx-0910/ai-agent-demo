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
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';

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
@ApiTags('用户')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * POST /users
   *
   * 创建新用户，请求体需包含 name 和 email
   */
  @ApiOperation({ summary: '创建用户', description: '创建一个新用户' })
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  /**
   * GET /users
   *
   * 获取所有用户列表
   */
  @ApiOperation({ summary: '获取所有用户', description: '返回用户列表' })
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
  @ApiOperation({ summary: '获取单个用户', description: '按 ID 获取用户详情' })
  @ApiParam({
    name: 'id',
    required: true,
    description: '用户 ID',
    type: Number,
  })
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
  @ApiOperation({ summary: '更新用户', description: '部分更新用户信息' })
  @ApiParam({
    name: 'id',
    required: true,
    description: '用户 ID',
    type: Number,
  })
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
  @ApiOperation({ summary: '删除用户', description: '按 ID 删除用户' })
  @ApiParam({
    name: 'id',
    required: true,
    description: '用户 ID',
    type: Number,
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }
}
