import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Order, OrderStatus } from '@/database/entities/order.entity';
import { OrderItem } from '@/database/entities/order-item.entity';
import { Product } from '@/database/entities/product.entity';
import { User } from '@/database/entities/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly dataSource: DataSource) {}

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
}
