import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-order-query.dto';

@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('orders')
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  @Get('orders/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }

  @Get('users/:userId/orders')
  findByUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.ordersService.findByUser(userId, query);
  }

  @Patch('orders/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.cancel(id);
  }
}
