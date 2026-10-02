import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9!@#$%&*+\-./:=?^_{}~]+$/, {
    message: 'Password contains invalid characters.',
  })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one number and one letter',
  })
  password!: string;
}
