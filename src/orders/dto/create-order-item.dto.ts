import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class CreateOrderItemDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}
