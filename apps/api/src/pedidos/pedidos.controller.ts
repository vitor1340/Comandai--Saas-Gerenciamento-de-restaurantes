import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.types';
import { ContaLiberadaGuard } from '../restaurantes/conta-liberada.guard';
import { AtualizarStatusPedidoDto } from './dto/atualizar-status-pedido.dto';
import { ListarPedidosQueryDto } from './dto/listar-pedidos-query.dto';
import { PedidosService } from './pedidos.service';

// ContaLiberadaGuard só na mutação (atualizarStatus) — leitura (listar,
// detalhar) continua liberada mesmo sem plano ativo, pra não quebrar o
// carregamento do painel (ver PlanoStatusBanner no frontend).
@UseGuards(JwtAuthGuard)
@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidosService: PedidosService) {}

  @Get()
  async listar(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListarPedidosQueryDto,
  ) {
    return this.pedidosService.listar(
      user.restauranteId,
      query.limit ?? 5,
      query.status,
    );
  }

  @Get(':id')
  detalhar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pedidosService.detalhar(user.restauranteId, id);
  }

  @UseGuards(ContaLiberadaGuard)
  @Patch(':id/status')
  atualizarStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AtualizarStatusPedidoDto,
  ) {
    return this.pedidosService.atualizarStatus(
      user.restauranteId,
      id,
      dto.status,
    );
  }
}
