import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { IpThrottlerGuard } from './common/ip-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RestaurantesModule } from './restaurantes/restaurantes.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { CategoriasModule } from './categorias/categorias.module';
import { ProdutosModule } from './produtos/produtos.module';
import { UploadModule } from './upload/upload.module';
import { LojaModule } from './loja/loja.module';
import { PagamentosModule } from './pagamentos/pagamentos.module';
import { AssinaturasModule } from './assinaturas/assinaturas.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    RestaurantesModule,
    DashboardModule,
    PedidosModule,
    CategoriasModule,
    ProdutosModule,
    UploadModule,
    LojaModule,
    PagamentosModule,
    AssinaturasModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: IpThrottlerGuard }],
})
export class AppModule {}
