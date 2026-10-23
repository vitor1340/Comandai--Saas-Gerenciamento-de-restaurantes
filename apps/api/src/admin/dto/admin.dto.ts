import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListarRestaurantesAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  busca?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;
}

export class AtualizarRestauranteAdminDto {
  @IsOptional()
  @IsBoolean()
  suspenso?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  estenderTrialDias?: number;
}
