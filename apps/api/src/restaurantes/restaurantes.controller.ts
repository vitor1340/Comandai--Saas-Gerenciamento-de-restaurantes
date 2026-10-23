import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.types';
import { ContaLiberadaGuard } from './conta-liberada.guard';
import { CargoUsuario } from '../../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CompletarCadastroDto } from './dto/completar-cadastro.dto';
import { UpdateRestauranteDto } from './dto/update-restaurante.dto';
import { RestaurantesService } from './restaurantes.service';

@UseGuards(JwtAuthGuard)
@Controller('restaurantes')
export class RestaurantesController {
  constructor(private readonly restaurantesService: RestaurantesService) {}

  // Sem ContaLiberadaGuard de propósito: é a rota que o frontend consulta pra
  // SABER se o plano expirou (guard de layout, banner de teste), então
  // precisa continuar acessível mesmo com o teste vencido.
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.restaurantesService.me(user.restauranteId);
  }

  // Onboarding de quem entrou com Google (restaurante criado sem CPF/CNPJ).
  // Sem ContaLiberadaGuard: é justamente o que destrava o guard.
  @UseGuards(RolesGuard)
  @Roles(CargoUsuario.DONO)
  @Patch('me/documento')
  completarCadastro(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CompletarCadastroDto,
  ) {
    return this.restaurantesService.completarCadastro(user.restauranteId, dto);
  }

  @UseGuards(ContaLiberadaGuard)
  @Patch('me')
  atualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateRestauranteDto,
  ) {
    return this.restaurantesService.atualizar(user.restauranteId, dto);
  }
}
