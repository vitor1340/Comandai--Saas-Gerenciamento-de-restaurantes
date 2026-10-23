import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.types';
import { ContaLiberadaGuard } from '../restaurantes/conta-liberada.guard';
import { CreateProdutoDto } from './dto/create-produto.dto';
import { UpdateProdutoDto } from './dto/update-produto.dto';
import { ProdutosService } from './produtos.service';

// ContaLiberadaGuard só nas rotas de escrita (ver método a método) — leitura
// (listar) continua liberada mesmo sem plano ativo, pra não quebrar o
// carregamento do painel (ver PlanoStatusBanner no frontend).
@UseGuards(JwtAuthGuard)
@Controller('produtos')
export class ProdutosController {
  constructor(private readonly produtosService: ProdutosService) {}

  @Get()
  listar(@CurrentUser() user: AuthenticatedUser) {
    return this.produtosService.listar(user.restauranteId);
  }

  @UseGuards(ContaLiberadaGuard)
  @Post()
  criar(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProdutoDto) {
    return this.produtosService.criar(user.restauranteId, dto);
  }

  @UseGuards(ContaLiberadaGuard)
  @Patch(':id')
  atualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProdutoDto,
  ) {
    return this.produtosService.atualizar(user.restauranteId, id, dto);
  }

  @UseGuards(ContaLiberadaGuard)
  @Delete(':id')
  remover(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.produtosService.remover(user.restauranteId, id);
  }
}
