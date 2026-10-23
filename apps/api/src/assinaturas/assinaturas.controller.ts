import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CargoUsuario } from '../../generated/prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AssinaturasService } from './assinaturas.service';
import { IniciarAssinaturaDto } from './dto/iniciar-assinatura.dto';
import { TrocarFaixaDto } from './dto/trocar-faixa.dto';

// Sem ContaLiberadaGuard de propósito: um dono com trial vencido ou assinatura
// cancelada precisa continuar conseguindo assinar/reativar por aqui.
// Mutações restritas a DONO (@Roles) — é dinheiro/cobrança da própria
// plataforma, decisão que não deveria ficar disponível pra GERENTE/ATENDENTE
// se esses cargos ganharem rotas próprias no futuro. GET/atual fica aberto
// pra qualquer cargo autenticado consultar.
@UseGuards(JwtAuthGuard)
@Controller('assinaturas')
export class AssinaturasController {
  constructor(private readonly assinaturasService: AssinaturasService) {}

  @Get('atual')
  atual(@CurrentUser() user: AuthenticatedUser) {
    return this.assinaturasService.assinaturaAtual(user.restauranteId);
  }

  @UseGuards(RolesGuard)
  @Roles(CargoUsuario.DONO)
  @Post()
  iniciar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IniciarAssinaturaDto,
  ) {
    return this.assinaturasService.iniciarAssinatura(
      user.restauranteId,
      dto.faixa,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(CargoUsuario.DONO)
  @Patch()
  trocarFaixa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TrocarFaixaDto,
  ) {
    return this.assinaturasService.trocarFaixa(user.restauranteId, dto.faixa);
  }

  @UseGuards(RolesGuard)
  @Roles(CargoUsuario.DONO)
  @HttpCode(200)
  @Delete()
  async cancelar(@CurrentUser() user: AuthenticatedUser) {
    await this.assinaturasService.cancelarAssinatura(user.restauranteId);
    return { mensagem: 'Assinatura cancelada' };
  }
}
