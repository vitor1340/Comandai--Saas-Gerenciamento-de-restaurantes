import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { PagamentosService } from '../pagamentos/pagamentos.service';
import { CriarPedidoPublicoDto } from '../pedidos/dto/criar-pedido-publico.dto';
import {
  calcularStatusPlano,
  statusPlanoBloqueiaAcesso,
} from '../restaurantes/plan-status.util';

// Reservado pra categoria sintética "Outros" (produtos sem categoria
// agrupados na loja pública) — nunca colide com um uuid() real gerado pelo
// Postgres/Prisma. `sintetica: true` no DTO deixa explícito pro frontend que
// não é uma categoria de verdade, sem precisar comparar esse id como string
// mágica em nenhum outro lugar.
const CATEGORIA_SINTETICA_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class LojaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidosService: PedidosService,
    private readonly pagamentosService: PagamentosService,
  ) {}

  async buscarPorSlug(slug: string) {
    const restaurante = await this.prisma.restaurante.findUnique({
      where: { slug },
      include: {
        categorias: {
          where: { ativa: true },
          orderBy: { ordem: 'asc' },
          include: {
            produtos: {
              where: { disponivel: true },
              orderBy: { nome: 'asc' },
            },
          },
        },
      },
    });

    // Suspenso pelo admin (spam, golpe, abuso) some do ar como se não
    // existisse — não dá pra deixar a vitrine pública de pé.
    if (!restaurante || restaurante.suspensoEm) {
      throw new NotFoundException('Loja não encontrada');
    }

    const mapearProduto = (produto: {
      id: string;
      nome: string;
      descricao: string | null;
      precoCentavos: number;
      imagemUrl: string | null;
    }) => ({
      id: produto.id,
      nome: produto.nome,
      descricao: produto.descricao,
      precoCentavos: produto.precoCentavos,
      imagemUrl: produto.imagemUrl,
    });

    const produtosSemCategoria = await this.prisma.produto.findMany({
      where: {
        restauranteId: restaurante.id,
        categoriaId: null,
        disponivel: true,
      },
      orderBy: { nome: 'asc' },
    });

    const produtoDestaque = [
      ...restaurante.categorias.flatMap((categoria) => categoria.produtos),
      ...produtosSemCategoria,
    ].find((produto) => produto.destaque);

    const categorias = [
      ...restaurante.categorias
        .filter((categoria) => categoria.produtos.length > 0)
        .map((categoria) => ({
          id: categoria.id,
          nome: categoria.nome,
          sintetica: false,
          produtos: categoria.produtos.map(mapearProduto),
        })),
      ...(produtosSemCategoria.length > 0
        ? [
            {
              id: CATEGORIA_SINTETICA_ID,
              nome: 'Outros',
              sintetica: true,
              produtos: produtosSemCategoria.map(mapearProduto),
            },
          ]
        : []),
    ];

    return {
      nome: restaurante.nome,
      slug: restaurante.slug,
      aberto: restaurante.aberto,
      whatsapp: restaurante.whatsapp,
      mercadoPagoConectado: Boolean(restaurante.mercadoPagoAccessToken),
      tagline: restaurante.tagline,
      logoUrl: restaurante.logoUrl,
      corDestaque: restaurante.corDestaque,
      tipoAtendimento: restaurante.tipoAtendimento,
      endereco: restaurante.endereco,
      horarioFuncionamento: restaurante.horarioFuncionamento,
      diferenciais: restaurante.diferenciais,
      produtoDestaque: produtoDestaque ? mapearProduto(produtoDestaque) : null,
      categorias,
    };
  }

  async buscarPedidoPublico(slug: string, pedidoId: string) {
    const restaurante = await this.prisma.restaurante.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!restaurante) {
      throw new NotFoundException('Loja não encontrada');
    }

    const pedido = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, restauranteId: restaurante.id },
      include: { itens: { include: { produto: true } }, pagamento: true },
    });
    if (!pedido) {
      throw new NotFoundException('Pedido não encontrado');
    }

    return {
      id: pedido.id,
      numero: pedido.numero,
      clienteNome: pedido.clienteNome,
      status: pedido.status,
      tipoEntrega: pedido.tipoEntrega,
      valorTotalCentavos: pedido.valorTotalCentavos,
      createdAt: pedido.createdAt,
      updatedAt: pedido.updatedAt,
      itens: pedido.itens.map((item) => ({
        produtoNome: item.produto.nome,
        quantidade: item.quantidade,
        precoUnitarioCentavos: item.precoUnitarioCentavos,
      })),
      pagamento: pedido.pagamento
        ? {
            status: pedido.pagamento.status,
            metodoPagamento: pedido.pagamento.metodoPagamento,
          }
        : null,
    };
  }

  async criarPagamento(slug: string, pedidoId: string) {
    return this.pagamentosService.criarPreferenciaParaPedido(slug, pedidoId);
  }

  async criarPedido(slug: string, dto: CriarPedidoPublicoDto) {
    const restaurante = await this.prisma.restaurante.findUnique({
      where: { slug },
      select: {
        id: true,
        aberto: true,
        statusAssinatura: true,
        trialEndsAt: true,
        suspensoEm: true,
      },
    });

    if (!restaurante || restaurante.suspensoEm) {
      throw new NotFoundException('Loja não encontrada');
    }
    if (!restaurante.aberto) {
      throw new ConflictException(
        'Esta loja está fechada no momento e não está recebendo pedidos',
      );
    }
    // Sem plano ativo, o dono não consegue nem ver o pedido no painel
    // (ContaLiberadaGuard bloqueia a mutação de status) — deixar a loja
    // continuar aceitando pedidos só criaria pedidos represados que
    // ninguém consegue atender. Mesmo kill switch do ContaLiberadaGuard (ver
    // comentário lá) — DESATIVAR_BLOQUEIO_PLANO=true libera também aqui.
    // Não usar em produção com cobrança ativa.
    if (
      process.env.DESATIVAR_BLOQUEIO_PLANO !== 'true' &&
      statusPlanoBloqueiaAcesso(calcularStatusPlano(restaurante))
    ) {
      throw new ConflictException(
        'Esta loja está temporariamente indisponível para novos pedidos',
      );
    }

    return this.pedidosService.criarPublico(restaurante.id, dto);
  }
}
