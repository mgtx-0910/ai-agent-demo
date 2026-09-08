import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

/**
 * UserService：用户业务逻辑层（内存版 CRUD）
 *
 * 演示要点：
 *  - 分层：Controller 只做"路由 + 参数取用"，真正的数据操作在 Service
 *  - 用数组模拟数据库，nextId 模拟自增主键
 *  - 抛 NotFoundException 交给全局 AllExceptionsFilter 统一格式化
 */
@Injectable()
export class UserService {
  /** 预置数据：与 auth 模块的 Token 映射保持一致（admin / zhangsan） */
  private users: User[] = [
    {
      id: 1,
      username: 'admin',
      name: '管理员',
      age: 30,
      role: 'admin',
    },
    {
      id: 2,
      username: 'zhangsan',
      name: '张三',
      age: 25,
      role: 'user',
    },
  ];

  /** 自增主键游标 */
  private nextId = 3;

  /** 创建用户：新用户角色固定为 'user' */
  create(createUserDto: CreateUserDto): User {
    const user: User = {
      id: this.nextId++,
      username: createUserDto.username,
      name: createUserDto.name,
      age: createUserDto.age,
      role: 'user',
    };
    this.users.push(user);
    return user;
  }

  /** 查询全部用户 */
  findAll(): User[] {
    return this.users;
  }

  /** 按 ID 查询单个用户，不存在抛 404 */
  findOne(id: number): User {
    const user = this.users.find((item) => item.id === id);
    if (!user) {
      throw new NotFoundException(`用户 #${id} 不存在`);
    }
    return user;
  }

  /** 部分更新：先确保存在，再把 DTO 字段浅合并到原对象 */
  update(id: number, updateUserDto: UpdateUserDto): User {
    const user = this.findOne(id);
    Object.assign(user, updateUserDto);
    return user;
  }

  /** 删除用户，返回被删除的对象；不存在抛 404 */
  remove(id: number): User {
    const index = this.users.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new NotFoundException(`用户 #${id} 不存在`);
    }
    const [removed] = this.users.splice(index, 1);
    return removed;
  }
}
