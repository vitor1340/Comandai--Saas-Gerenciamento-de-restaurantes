import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminService } from './admin.service';
import {
  AtualizarRestauranteAdminDto,
  ListarRestaurantesAdminDto,
} from './dto/admin.dto';
import { SuperAdminGuard } from './super-admin.guard';

@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('restaurantes')
  listar(@Query() query: ListarRestaurantesAdminDto) {
    return this.adminService.listarRestaurantes(query.busca, query.pagina ?? 1);
  }

  @Patch('restaurantes/:id')
  async atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarRestauranteAdminDto,
  ) {
    await this.adminService.atualizarRestaurante(id, dto);
    return { ok: true };
  }
}
