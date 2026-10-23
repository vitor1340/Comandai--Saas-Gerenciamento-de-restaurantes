import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsCpfOuCnpj } from '../../common/documento.util';
import { NormalizarEmail } from './email.transform';

export class RegistrarDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nomeRestaurante!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nomeDono!: string;

  @NormalizarEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  // bcrypt ignora tudo depois de 72 bytes.
  @MaxLength(72)
  senha!: string;

  @IsString()
  @MaxLength(18)
  @IsCpfOuCnpj()
  documento!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  turnstileToken?: string;
}
