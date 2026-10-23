import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CargoUsuario,
  Prisma,
  StatusAssinatura,
} from '../../generated/prisma/client';
import {
  mascararDocumento,
  normalizarDocumento,
} from '../common/documento.util';
import { PrismaService } from '../prisma/prisma.service';
import { calcularStatusPlano } from '../restaurantes/plan-status.util';
import { AtualizarRestauranteAdminDto } from './dto/admin.dto';

const ITENS_POR_PAGINA = 50;
const DIA_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listarRestaurantes(busca: string | undefined, pagina: number) {
    const termo = busca?.trim();
    const digitos = termo ? normalizarDocumento(termo) : '';

    const where: Prisma.RestauranteWhereInput = termo
      ? {
          OR: [
            { nome: { contains: termo, mode: 'insensitive' } },
            { slug: { contains: termo.toLowerCase() } },
            {
              usuarios: {
                some: { email: { contains: termo.toLowerCase() } },
              },
            },
            ...(digitos.length >= 3
              ? [{ documento: { contains: digitos } }]
              : []),
            { ipCadastro: termo },
          ],
        }
      : {};

    const [total, restaurantes] = await Promise.all([
      this.prisma.restaurante.count({ where }),
      this.prisma.restaurante.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pagina - 1) * ITENS_POR_PAGINA,
        take: ITENS_POR_PAGINA,
        select: {
          id: true,
          nome: true,
          slug: true,
          documento: true,
          statusAssinatura: true,
          trialEndsAt: true,
          suspensoEm: true,
          ipCadastro: true,
          createdAt: true,
          _count: { select: { pedidos: true, produtos: true } },
          usuarios: {
            where: { cargo: CargoUsuario.DONO },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { email: true, emailVerificadoEm: true, googleId: true },
          },
        },
      }),
    ]);

    return {
      total,
      pagina,
      itensPorPagina: ITENS_POR_PAGINA,
      itens: restaurantes.map((r) => {
        const dono = r.usuarios[0];
        return {
          id: r.id,
          nome: r.nome,
          slug: r.slug,
          documento: r.documento ? mascararDocumento(r.documento) : null,
          emailDono: dono?.email ?? null,
          emailVerificado: Boolean(dono?.emailVerificadoEm),
          loginGoogle: Boolean(dono?.googleId),
          statusPlano: calcularStatusPlano(r),
          trialEndsAt: r.trialEndsAt.toISOString(),
          suspenso: r.suspensoEm !== null,
          ipCadastro: r.ipCadastro,
          pedidosCount: r._count.pedidos,
          produtosCount: r._count.produtos,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    };
  }

  async atualizarRestaurante(id: string, dto: AtualizarRestauranteAdminDto) {
    const restaurante = await this.prisma.restaurante.findUnique({
      where: { id },
      select: { statusAssinatura: true, trialEndsAt: true },
    });
    if (!restaurante) {
      throw new NotFoundException('Restaurante não encontrado');
    }

    const data: Prisma.RestauranteUpdateInput = {};

    if (dto.suspenso !== undefined) {
      data.suspensoEm = dto.suspenso ? new Date() : null;
    }

    // Estender só faz sentido em teste grátis. Conta a partir de agora se o
    // teste já venceu — senão "+7 dias" num trial vencido há 10 dias não
    // liberaria nada.
    if (
      dto.estenderTrialDias !== undefined &&
      restaurante.statusAssinatura === StatusAssinatura.TRIALING
    ) {
      const base = Math.max(restaurante.trialEndsAt.getTime(), Date.now());
      data.trialEndsAt = new Date(base + dto.estenderTrialDias * DIA_MS);
    }

    await this.prisma.restaurante.update({ where: { id }, data });
  }
}
