import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Order, OrderStatus } from '@/database/entities/order.entity';
import { OrderItem } from '@/database/entities/order-item.entity';
import { Product } from '@/database/entities/product.entity';
import { User } from '@/database/entities/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ListOrdersQueryDto } from './dto/list-order-query.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    const ids = dto.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate productId in items');
    }

    const items = [...dto.items].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    );

    return this.dataSource.transaction(async (manager) => {
      const userExists = await manager.existsBy(User, { id: dto.userId });
      if (!userExists) throw new NotFoundException('User not found!');

      const orderItems: OrderItem[] = [];
      let totalCents = 0;

      for (const item of items) {
        const result = await manager
          .createQueryBuilder()
          .update(Product)
          .set({ stock: () => 'stock - :qty' })
          .where('id = :id AND stock >= :qty', {
            id: item.productId,
            qty: item.quantity,
          })
          .execute();

        if (result.affected === 0) {
          const exists = await manager.existsBy(Product, {
            id: item.productId,
          });
          if (!exists) {
            throw new NotFoundException(`Product ${item.productId} not found`);
          }
          throw new ConflictException(
            `Insufficient stock for product ${item.productId}`,
          );
        }

        const product = await manager.findOneByOrFail(Product, {
          id: item.productId,
        });

        orderItems.push(
          manager.create(OrderItem, {
            productId: product.id,
            quantity: item.quantity,
            unitPriceCents: product.priceCents,
          }),
        );
        totalCents += product.priceCents * item.quantity;
      }

      const order = manager.create(Order, {
        userId: dto.userId,
        status: OrderStatus.PENDING,
        totalCents,
        items: orderItems,
      });

      return manager.save(order);
    });
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: { items: { product: true } },
      select: {
        id: true,
        status: true,
        totalCents: true,
        createdAt: true,
        items: {
          id: true,
          quantity: true,
          unitPriceCents: true,
          product: { id: true, name: true },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found!');

    return order;
  }

  async findByUser(userId: string, query: ListOrdersQueryDto) {
    const { limit, offset } = query;

    const [orders, total] = await this.orderRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
      skip: offset,
    });

    return {
      data: orders,
      meta: { total, limit, offset },
    };
  }
}
