import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { Product } from '@/database/entities/product.entity';
import { REDIS } from '@/redis/redis.module';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const LIST_KEY = 'products:list';
const LIST_TTL_SECONDS = 60;

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async create(data: CreateProductDto): Promise<Product> {
    const newProduct = this.productRepository.create(data);
    const saved = await this.productRepository.save(newProduct);
    await this.invalidateList();
    return saved;
  }

  async findAll(): Promise<Product[]> {
    const cached = await this.getListFromCache();
    if (cached) {
      this.logger.log('products:list HIT');
      return cached;
    }

    this.logger.log('products:list MISS');
    const products = await this.productRepository.find();
    await this.setListInCache(products);
    return products;
  }

  async findOne(id: string): Promise<Product> {
    const found = await this.productRepository.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Product not found!');
    return found;
  }

  async update(id: string, data: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);
    const updated = this.productRepository.merge(product, data);
    const saved = await this.productRepository.save(updated);
    await this.invalidateList();
    return saved;
  }

  async remove(id: string): Promise<void> {
    const product = await this.findOne(id);
    await this.productRepository.remove(product);
    await this.invalidateList();
  }

  private async getListFromCache(): Promise<Product[] | null> {
    try {
      const raw = await this.redis.get(LIST_KEY);
      return raw ? (JSON.parse(raw) as Product[]) : null;
    } catch (error) {
      this.logger.warn(`Cache read failed: ${(error as Error).message}`);
      return null;
    }
  }

  private async setListInCache(products: Product[]): Promise<void> {
    try {
      await this.redis.set(
        LIST_KEY,
        JSON.stringify(products),
        'EX',
        LIST_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`Cache write failed: ${(error as Error).message}`);
    }
  }

  private async invalidateList(): Promise<void> {
    try {
      await this.redis.del(LIST_KEY);
    } catch (error) {
      this.logger.warn(
        `Cache invalidation failed: ${(error as Error).message}`,
      );
    }
  }
}
