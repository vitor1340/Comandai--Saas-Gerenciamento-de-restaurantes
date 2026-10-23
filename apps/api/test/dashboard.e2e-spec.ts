import 'dotenv/config';
import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  CanalVenda,
  StatusPedido,
  TipoEntrega,
} from './../generated/prisma/client';
import { addDays, variacaoPercentual } from './../src/common/date.util';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

interface RespostaAuth {
  accessToken: string;
  usuario: { id: string };
}

interface DashboardSummary {
  vendasHoje: { valorCentavos: number; variacaoPercentual: number };
  pedidosHoje: { quantidade: number; variacaoAbsoluta: number };
  ticketMedio: { valorCentavos: number; variacaoPercentual: number };
  tempoMedioPreparo: { minutos: number; variacaoMinutos: number };
  ultimoPedidoNovo: {
    numero: number;
    clienteNome: string;
    valorTotalCentavos: number;
  } | null;
}

interface SalesPerformance {
  totalPeriodoCentavos: number;
  serie: { valorCentavos: number }[];
}

interface SalesChannels {
  totalPedidos: number;
  canais: { canal: string; quantidade: number; percentual: number }[];
}

/**
 * Cobre os 3 endpoints do dashboard com dados plantados diretamente via Prisma
 * (o endpoint público de pedidos não permite controlar createdAt/status/canal/
 * tempoPreparoMinutos), incluindo exclusão de pedidos cancelados e isolamento
 * de tenant.
 */
describe('Dashboard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const execucao = randomUUID().slice(0, 8);
  let tokenA: string;
  let restauranteAId: string;
  let restauranteBId: string;
  let usuarioAId: string;
  let usuarioBId: string;

  const hoje = new Date();
  hoje.setHours(12, 0, 0, 0);
  const ontem = addDays(hoje, -1);

  const pedidoNovoHoje = { valorTotalCentavos: 5000, tempoPreparoMinutos: 20 };
  const vendasHojeEsperado = 5000 + 2000 + 3000; // exclui o cancelado (9999)
  const vendasOntemEsperado = 4000 + 1000;
  const pedidosHojeEsperado = 3;
  const pedidosOntemEsperado = 2;
  const tempoMedioHojeEsperado = Math.round((20 + 10) / 2);
  const tempoMedioOntemEsperado = Math.round((15 + 25) / 2);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const registrarA = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja Dashboard Teste ${execucao}`,
        nomeDono: 'Dono Dashboard',
        email: `dono-dashboard-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-dashboard-${execucao}@teste.comandai.dev`,
    );
    const corpoA = registrarA.body as RespostaAuth;
    tokenA = corpoA.accessToken;
    usuarioAId = corpoA.usuario.id;
    const usuarioA = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioAId },
    });
    restauranteAId = usuarioA.restauranteId;

    const registrarB = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja Dashboard Teste B ${execucao}`,
        nomeDono: 'Dono B',
        email: `dono-dashboard-b-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-dashboard-b-${execucao}@teste.comandai.dev`,
    );
    const corpoB = registrarB.body as RespostaAuth;
    usuarioBId = corpoB.usuario.id;
    const usuarioB = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioBId },
    });
    restauranteBId = usuarioB.restauranteId;

    // hoje: 3 pedidos válidos (2 CARDAPIO_DIGITAL, 1 WHATSAPP, 0 QR_CODE_SALAO) + 1 cancelado
    await prisma.pedido.create({
      data: {
        restauranteId: restauranteAId,
        numero: 1,
        clienteNome: 'Cliente Novo',
        canal: CanalVenda.CARDAPIO_DIGITAL,
        tipoEntrega: TipoEntrega.DELIVERY,
        status: StatusPedido.NOVO,
        valorTotalCentavos: pedidoNovoHoje.valorTotalCentavos,
        tempoPreparoMinutos: pedidoNovoHoje.tempoPreparoMinutos,
        createdAt: hoje,
      },
    });
    await prisma.pedido.create({
      data: {
        restauranteId: restauranteAId,
        numero: 2,
        clienteNome: 'Cliente Em Preparo',
        canal: CanalVenda.CARDAPIO_DIGITAL,
        tipoEntrega: TipoEntrega.SALAO,
        status: StatusPedido.EM_PREPARO,
        valorTotalCentavos: 2000,
        tempoPreparoMinutos: 10,
        createdAt: hoje,
      },
    });
    await prisma.pedido.create({
      data: {
        restauranteId: restauranteAId,
        numero: 3,
        clienteNome: 'Cliente Confirmado',
        canal: CanalVenda.WHATSAPP,
        tipoEntrega: TipoEntrega.RETIRADA,
        status: StatusPedido.CONFIRMADO,
        valorTotalCentavos: 3000,
        createdAt: hoje,
      },
    });
    await prisma.pedido.create({
      data: {
        restauranteId: restauranteAId,
        numero: 4,
        clienteNome: 'Cliente Cancelado',
        canal: CanalVenda.CARDAPIO_DIGITAL,
        tipoEntrega: TipoEntrega.DELIVERY,
        status: StatusPedido.CANCELADO,
        valorTotalCentavos: 9999,
        createdAt: hoje,
      },
    });

    // ontem: 2 pedidos entregues
    await prisma.pedido.create({
      data: {
        restauranteId: restauranteAId,
        numero: 5,
        clienteNome: 'Cliente Ontem 1',
        canal: CanalVenda.CARDAPIO_DIGITAL,
        tipoEntrega: TipoEntrega.DELIVERY,
        status: StatusPedido.ENTREGUE,
        valorTotalCentavos: 4000,
        tempoPreparoMinutos: 15,
        createdAt: ontem,
      },
    });
    await prisma.pedido.create({
      data: {
        restauranteId: restauranteAId,
        numero: 6,
        clienteNome: 'Cliente Ontem 2',
        canal: CanalVenda.WHATSAPP,
        tipoEntrega: TipoEntrega.RETIRADA,
        status: StatusPedido.ENTREGUE,
        valorTotalCentavos: 1000,
        tempoPreparoMinutos: 25,
        createdAt: ontem,
      },
    });

    // restaurante B: pedido com valor alto, não pode vazar pros números de A
    await prisma.pedido.create({
      data: {
        restauranteId: restauranteBId,
        numero: 1,
        clienteNome: 'Cliente B',
        canal: CanalVenda.WHATSAPP,
        tipoEntrega: TipoEntrega.DELIVERY,
        status: StatusPedido.NOVO,
        valorTotalCentavos: 999_999,
        createdAt: hoje,
      },
    });
  });

  afterAll(async () => {
    await prisma.pedido.deleteMany({
      where: { restauranteId: { in: [restauranteAId, restauranteBId] } },
    });
    await prisma.usuario.deleteMany({
      where: { id: { in: [usuarioAId, usuarioBId] } },
    });
    await prisma.restaurante.deleteMany({
      where: { id: { in: [restauranteAId, restauranteBId] } },
    });
    await app.close();
  });

  it('/dashboard/summary exige autenticação (401)', () => {
    return request(app.getHttpServer())
      .get('/api/dashboard/summary')
      .expect(401);
  });

  it('/dashboard/summary calcula vendas/pedidos/ticket médio/tempo de preparo excluindo cancelados', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const corpo = resposta.body as DashboardSummary;

    expect(corpo.vendasHoje.valorCentavos).toBe(vendasHojeEsperado);
    expect(corpo.vendasHoje.variacaoPercentual).toBe(
      variacaoPercentual(vendasHojeEsperado, vendasOntemEsperado),
    );
    expect(corpo.pedidosHoje.quantidade).toBe(pedidosHojeEsperado);
    expect(corpo.pedidosHoje.variacaoAbsoluta).toBe(
      pedidosHojeEsperado - pedidosOntemEsperado,
    );
    expect(corpo.ticketMedio.valorCentavos).toBe(
      Math.round(vendasHojeEsperado / pedidosHojeEsperado),
    );
    expect(corpo.tempoMedioPreparo.minutos).toBe(tempoMedioHojeEsperado);
    expect(corpo.tempoMedioPreparo.variacaoMinutos).toBe(
      tempoMedioHojeEsperado - tempoMedioOntemEsperado,
    );
    expect(corpo.ultimoPedidoNovo).toEqual({
      numero: 1,
      clienteNome: 'Cliente Novo',
      valorTotalCentavos: pedidoNovoHoje.valorTotalCentavos,
    });
  });

  it('/dashboard/sales-performance usa 7 dias por padrão e reflete o total de hoje', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/dashboard/sales-performance')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const corpo = resposta.body as SalesPerformance;

    expect(corpo.serie).toHaveLength(7);
    expect(corpo.serie[corpo.serie.length - 1].valorCentavos).toBe(
      vendasHojeEsperado,
    );
  });

  it('/dashboard/sales-performance respeita o parâmetro "dias"', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/dashboard/sales-performance?dias=2')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const corpo = resposta.body as SalesPerformance;

    expect(corpo.serie).toHaveLength(2);
    expect(corpo.totalPeriodoCentavos).toBe(
      vendasHojeEsperado + vendasOntemEsperado,
    );
  });

  it('/dashboard/sales-channels sempre retorna os 3 canais, mesmo com quantidade 0, e isola por tenant', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/dashboard/sales-channels')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const corpo = resposta.body as SalesChannels;

    expect(corpo.totalPedidos).toBe(pedidosHojeEsperado);
    expect(corpo.canais).toHaveLength(3);

    const porCanal = new Map(corpo.canais.map((c) => [c.canal, c]));
    expect(porCanal.get('CARDAPIO_DIGITAL')?.quantidade).toBe(2);
    expect(porCanal.get('WHATSAPP')?.quantidade).toBe(1);
    expect(porCanal.get('QR_CODE_SALAO')?.quantidade).toBe(0);
    expect(porCanal.get('QR_CODE_SALAO')?.percentual).toBe(0);

    // o pedido de R$ 9.999,99 do restaurante B não pode aparecer nos números de A
    expect(corpo.totalPedidos).not.toBe(pedidosHojeEsperado + 1);
  });
});
