import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsCpfOuCnpj } from '../../common/documento.util';

export class CompletarCadastroDto {
  @IsString()
  @MaxLength(18)
  @IsCpfOuCnpj()
  documento!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nomeRestaurante!: string;
}
