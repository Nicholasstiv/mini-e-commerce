import { User } from '@/database/entities/user.entity';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';

export type SafeUser = Omit<User, 'password'>;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  async create(data: CreateUserDto): Promise<SafeUser> {
    const hash = await bcrypt.hash(data.password, 10);
    const user = this.userRepository.create({
      email: data.email,
      password: hash,
    });

    const saved = await this.saveOrThrowConflict(user);

    return this.toSafeUser(saved);
  }

  async findAll(): Promise<User[]> {
    return await this.userRepository.find();
  }

  async findOne(id: string): Promise<User> {
    const found = await this.userRepository.findOne({ where: { id } });

    if (!found) throw new NotFoundException('User not found!');

    return found;
  }

  async update(id: string, data: UpdateUserDto): Promise<SafeUser> {
    const existingUser = await this.findOne(id);

    const { password, ...rest } = data;

    this.userRepository.merge(existingUser, rest);

    if (password) {
      existingUser.password = await bcrypt.hash(password, 10);
    }

    const saved = await this.saveOrThrowConflict(existingUser);
    return this.toSafeUser(saved);
  }

  async remove(id: string): Promise<void> {
    const found = await this.findOne(id);
    await this.userRepository.remove(found);

    return;
  }

  private async saveOrThrowConflict(user: User): Promise<User> {
    try {
      return await this.userRepository.save(user);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }
  }

  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
