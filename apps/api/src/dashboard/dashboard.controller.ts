import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.types';
import { DashboardService } from './dashboard.service';
import { SalesPerformanceQueryDto } from './dto/sales-performance-query.dto';

// Sem ContaLiberadaGuard: são só leituras (métricas), e o painel precisa
// carregar mesmo com trial vencido/assinatura cancelada — ver
// PlanoStatusBanner no frontend, que é o que de fato avisa o usuário.
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.summary(user.restauranteId, user.userId);
  }

  @Get('sales-performance')
  salesPerformance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SalesPerformanceQueryDto,
  ) {
    return this.dashboardService.salesPerformance(
      user.restauranteId,
      query.dias ?? 7,
    );
  }

  @Get('sales-channels')
  salesChannels(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.salesChannels(user.restauranteId);
  }
}
