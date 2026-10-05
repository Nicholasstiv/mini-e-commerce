import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(100000000)
  priceCents!: number;

  @IsInt()
  @Min(0)
  @Max(2000000000)
  stock!: number;
}
