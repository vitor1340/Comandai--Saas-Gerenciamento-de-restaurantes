import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { NormalizarEmail } from './email.transform';

export class EsqueciSenhaDto {
  @NormalizarEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  turnstileToken?: string;
}
