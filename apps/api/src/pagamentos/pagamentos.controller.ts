import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CargoUsuario } from '../../generated/prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { exigirVariavelAmbiente } from '../common/env.util';
import { ContaLiberadaGuard } from '../restaurantes/conta-liberada.guard';
import { PagamentosService } from './pagamentos.service';

// Conectar/desconectar a conta Mercado Pago do restaurante é decisão de
// dono (é a conta bancária do negócio) — restrito via @Roles pra já não
// depender de ninguém lembrar disso se GERENTE/ATENDENTE ganharem acesso
// ao painel no futuro.
@Controller('pagamentos')
export class PagamentosController {
  private readonly logger = new Logger(PagamentosController.name);

  constructor(private readonly pagamentosService: PagamentosService) {}

  @UseGuards(JwtAuthGuard, ContaLiberadaGuard, RolesGuard)
  @Roles(CargoUsuario.DONO)
  @Get('conectar')
  async conectar(@CurrentUser() user: AuthenticatedUser) {
    return {
      url: await this.pagamentosService.gerarLinkConexao(user.restauranteId),
    };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const origemFrontend = exigirVariavelAmbiente('CORS_ORIGIN');
    try {
      await this.pagamentosService.tratarCallback(code, state);
      res.redirect(`${origemFrontend}/configuracoes?mercadopago=conectado`);
    } catch (erro) {
      this.logger.error('Falha ao tratar callback do Mercado Pago', erro);
      res.redirect(`${origemFrontend}/configuracoes?mercadopago=erro`);
    }
  }

  @UseGuards(JwtAuthGuard, ContaLiberadaGuard, RolesGuard)
  @Roles(CargoUsuario.DONO)
  @HttpCode(200)
  @Delete('conectar')
  async desconectar(@CurrentUser() user: AuthenticatedUser) {
    await this.pagamentosService.desconectar(user.restauranteId);
    return { mensagem: 'Mercado Pago desconectado' };
  }
}
