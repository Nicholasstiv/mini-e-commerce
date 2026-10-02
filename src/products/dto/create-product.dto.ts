import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsInt()
  @Min(1)
  priceCents!: number;

  @IsInt()
  @Min(0)
  stock!: number;
}
