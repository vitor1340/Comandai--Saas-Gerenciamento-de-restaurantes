import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerificarEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;
}
