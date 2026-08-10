import { Inject, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { EntityManager } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  @Inject(EntityManager)
  entityManager: EntityManager;

  create(createUserDto: CreateUserDto): Promise<User> {
    return this.entityManager.save(User, createUserDto);
  }

  findAll(): Promise<User[]> {
    return this.entityManager.find(User);
  }

  findOne(id: number): Promise<User | null> {
    return this.entityManager.findOne(User, { where: { id } });
  }

  update(
    id: number,
    updateUserDto: UpdateUserDto,
  ): Promise<import('typeorm').UpdateResult> {
    return this.entityManager.update(User, id, updateUserDto);
  }

  remove(id: number): Promise<import('typeorm').DeleteResult> {
    return this.entityManager.delete(User, id);
  }
}
