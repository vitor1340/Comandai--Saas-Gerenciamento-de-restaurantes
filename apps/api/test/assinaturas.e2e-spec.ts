import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { MercadoPagoClient } from './../src/pagamentos/mercado-pago.client';
import { PrismaService } from './../src/prisma/prisma.service';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

interface RespostaAuth {
  accessToken: string;
  usuario: { id: string };
}

interface RestauranteMe {
  id: string;
  slug: string;
}

/**
 * O SDK do Mercado Pago é substituído por um mock (MercadoPagoClient) — o
 * mesmo provider é compartilhado com o módulo de pagamentos de pedidos
 * (pagamentos.module.ts exporta MercadoPagoClient), então um único
 * overrideProvider cobre os dois módulos. O que este teste cobre é a lógica
 * que o Comandaí é responsável por: persistência do preapproval/faixa,
 * mapeamento de status do webhook de assinatura, e o bloqueio de acesso
 * (ContaLiberadaGuard) quando a assinatura é cancelada.
 */
describe('Assinatura recorrente via Mercado Pago (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mercadoPagoMock: {
    gerarUrlAutorizacao: jest.Mock;
    trocarCodigoPorToken: jest.Mock;
    renovarToken: jest.Mock;
    criarPreferencia: jest.Mock;
    buscarPagamento: jest.Mock;
    criarAssinatura: jest.Mock;
    buscarAssinatura: jest.Mock;
    atualizarValorAssinatura: jest.Mock;
    cancelarAssinatura: jest.Mock;
    validarAssinaturaWebhook: jest.Mock;
  };

  const execucao = randomUUID().slice(0, 8);
  const PREAPPROVAL_ID = 'preapproval-abc';

  let token: string;
  let restauranteId: string;
  let restauranteSemAssinaturaId: string;

  beforeAll(async () => {
    mercadoPagoMock = {
      gerarUrlAutorizacao: jest.fn(),
      trocarCodigoPorToken: jest.fn(),
      renovarToken: jest.fn(),
      criarPreferencia: jest.fn(),
      buscarPagamento: jest.fn(),
      criarAssinatura: jest.fn().mockResolvedValue({
        id: PREAPPROVAL_ID,
        initPoint: `https://mercadopago.com/subscriptions/${PREAPPROVAL_ID}`,
      }),
      buscarAssinatura: jest.fn(),
      atualizarValorAssinatura: jest.fn().mockResolvedValue(undefined),
      cancelarAssinatura: jest.fn().mockResolvedValue(undefined),
      validarAssinaturaWebhook: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MercadoPagoClient)
      .useValue(mercadoPagoMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const registrar = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja Assinaturas Teste ${execucao}`,
        nomeDono: 'Dono Assinaturas',
        email: `dono-assinaturas-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-assinaturas-${execucao}@teste.comandai.dev`,
    );
    token = (registrar.body as RespostaAuth).accessToken;

    const me = await request(app.getHttpServer())
      .get('/api/restaurantes/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    restauranteId = (me.body as RestauranteMe).id;

    mercadoPagoMock.validarAssinaturaWebhook.mockImplementation(() => {});
  });

  afterAll(async () => {
    const restauranteIds = [restauranteId, restauranteSemAssinaturaId].filter(
      (id): id is string => Boolean(id),
    );
    if (restauranteIds.length > 0) {
      await prisma.eventoAssinatura.deleteMany({
        where: { restauranteId: { in: restauranteIds } },
      });
      await prisma.usuario.deleteMany({
        where: { restauranteId: { in: restauranteIds } },
      });
      await prisma.restaurante.deleteMany({
        where: { id: { in: restauranteIds } },
      });
    }
    await app.close();
  });

  it('sem autenticação, todas as rotas de assinatura são rejeitadas (401)', async () => {
    await request(app.getHttpServer())
      .get('/api/assinaturas/atual')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/assinaturas')
      .send({ faixa: 'ATE_150' })
      .expect(401);
    await request(app.getHttpServer())
      .patch('/api/assinaturas')
      .send({ faixa: 'ATE_150' })
      .expect(401);
    await request(app.getHttpServer()).delete('/api/assinaturas').expect(401);
  });

  it('estado inicial: sem assinatura', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/assinaturas/atual')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(resposta.body).toMatchObject({
      temAssinatura: false,
      faixaAssinatura: null,
      statusAssinatura: 'TRIALING',
      precoCentavos: null,
    });
  });

  it('cria a assinatura na faixa escolhida e persiste preapproval + faixa', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/api/assinaturas')
      .set('Authorization', `Bearer ${token}`)
      .send({ faixa: 'DE_151_A_250' })
      .expect(201);
    expect((resposta.body as { initPoint: string }).initPoint).toBe(
      `https://mercadopago.com/subscriptions/${PREAPPROVAL_ID}`,
    );

    expect(mercadoPagoMock.criarAssinatura).toHaveBeenLastCalledWith(
      expect.objectContaining({
        precoCentavos: 11590,
        externalReference: restauranteId,
      }),
    );

    const restaurante = await prisma.restaurante.findUniqueOrThrow({
      where: { id: restauranteId },
    });
    expect(restaurante.mercadoPagoPreapprovalId).toBe(PREAPPROVAL_ID);
    expect(restaurante.faixaAssinatura).toBe('DE_151_A_250');
    // ainda TRIALING — só o webhook confirma a autorização de verdade
    expect(restaurante.statusAssinatura).toBe('TRIALING');
  });

  it('rejeita nova assinatura com 409 quando já existe uma ACTIVE/PAST_DUE em andamento', async () => {
    await prisma.restaurante.update({
      where: { id: restauranteId },
      data: { statusAssinatura: 'ACTIVE' },
    });

    await request(app.getHttpServer())
      .post('/api/assinaturas')
      .set('Authorization', `Bearer ${token}`)
      .send({ faixa: 'ATE_150' })
      .expect(409);
  });

  describe('webhook de assinatura', () => {
    it('assinatura de webhook inválida é rejeitada (401)', async () => {
      mercadoPagoMock.validarAssinaturaWebhook.mockImplementationOnce(() => {
        throw new UnauthorizedException('Assinatura de webhook inválida');
      });

      await request(app.getHttpServer())
        .post('/api/assinaturas/webhook')
        .query({ 'data.id': PREAPPROVAL_ID })
        .set('x-signature', 'ts=1,v1=forjada')
        .set('x-request-id', 'req-1')
        .expect(401);
    });

    it('notificação para um preapproval desconhecido é ignorada (200), sem erro', async () => {
      mercadoPagoMock.buscarAssinatura.mockResolvedValueOnce({
        status: 'authorized',
        externalReference: 'restaurante-que-nao-existe',
        transactionAmount: 64.9,
        bruto: { id: 'preapproval-desconhecido', status: 'authorized' },
      });

      await request(app.getHttpServer())
        .post('/api/assinaturas/webhook')
        .query({ 'data.id': 'preapproval-desconhecido' })
        .set('x-signature', 'ts=1,v1=valida')
        .set('x-request-id', 'req-2')
        .expect(200);
    });

    it('authorized grava o evento de auditoria e atualiza o restaurante para ACTIVE', async () => {
      mercadoPagoMock.buscarAssinatura.mockResolvedValue({
        status: 'authorized',
        externalReference: restauranteId,
        transactionAmount: 115.9,
        bruto: { id: PREAPPROVAL_ID, status: 'authorized' },
      });

      await request(app.getHttpServer())
        .post('/api/assinaturas/webhook')
        .query({ 'data.id': PREAPPROVAL_ID })
        .set('x-signature', 'ts=1,v1=valida')
        .set('x-request-id', 'req-3')
        .expect(200);

      const restaurante = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      expect(restaurante.statusAssinatura).toBe('ACTIVE');

      const eventos = await prisma.eventoAssinatura.findMany({
        where: { restauranteId },
        orderBy: { createdAt: 'asc' },
      });
      expect(eventos.length).toBeGreaterThanOrEqual(1);
      expect(eventos.at(-1)!.tipo).toBe('authorized');
    });

    it('replay da mesma notificação é idempotente (mesmo resultado, sem erro)', async () => {
      await request(app.getHttpServer())
        .post('/api/assinaturas/webhook')
        .query({ 'data.id': PREAPPROVAL_ID })
        .set('x-signature', 'ts=1,v1=valida')
        .set('x-request-id', 'req-4')
        .expect(200);

      const restaurante = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      expect(restaurante.statusAssinatura).toBe('ACTIVE');
    });

    it('paused atualiza para PAST_DUE, sem bloquear o acesso', async () => {
      mercadoPagoMock.buscarAssinatura.mockResolvedValueOnce({
        status: 'paused',
        externalReference: restauranteId,
        transactionAmount: 115.9,
        bruto: { id: PREAPPROVAL_ID, status: 'paused' },
      });

      await request(app.getHttpServer())
        .post('/api/assinaturas/webhook')
        .query({ 'data.id': PREAPPROVAL_ID })
        .set('x-signature', 'ts=1,v1=valida')
        .set('x-request-id', 'req-5')
        .expect(200);

      const restaurante = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      expect(restaurante.statusAssinatura).toBe('PAST_DUE');

      await request(app.getHttpServer())
        .patch('/api/restaurantes/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ tagline: 'ainda liberado com past_due' })
        .expect(200);
    });

    it('cancelled atualiza para CANCELED e passa a bloquear o acesso (402)', async () => {
      mercadoPagoMock.buscarAssinatura.mockResolvedValueOnce({
        status: 'cancelled',
        externalReference: restauranteId,
        transactionAmount: 115.9,
        bruto: { id: PREAPPROVAL_ID, status: 'cancelled' },
      });

      await request(app.getHttpServer())
        .post('/api/assinaturas/webhook')
        .query({ 'data.id': PREAPPROVAL_ID })
        .set('x-signature', 'ts=1,v1=valida')
        .set('x-request-id', 'req-6')
        .expect(200);

      const restaurante = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      expect(restaurante.statusAssinatura).toBe('CANCELED');

      await request(app.getHttpServer())
        .patch('/api/restaurantes/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ tagline: 'deveria estar bloqueado' })
        .expect(402);
    });
  });

  describe('troca de faixa e cancelamento', () => {
    it('PATCH e DELETE /assinaturas sem preapproval retornam 409', async () => {
      const registrar = await request(app.getHttpServer())
        .post('/api/auth/registrar')
        .send({
          nomeRestaurante: `Loja Sem Assinatura ${execucao}`,
          nomeDono: 'Dono Sem Assinatura',
          email: `dono-sem-assinatura-${execucao}@teste.comandai.dev`,
          senha: 'senha-teste-123',
          documento: gerarCpfValido(),
        })
        .expect(201);
      await marcarEmailVerificado(
        prisma,
        `dono-sem-assinatura-${execucao}@teste.comandai.dev`,
      );
      const tokenSemAssinatura = (registrar.body as RespostaAuth).accessToken;
      const meSemAssinatura = await request(app.getHttpServer())
        .get('/api/restaurantes/me')
        .set('Authorization', `Bearer ${tokenSemAssinatura}`)
        .expect(200);
      restauranteSemAssinaturaId = (meSemAssinatura.body as RestauranteMe).id;

      await request(app.getHttpServer())
        .patch('/api/assinaturas')
        .set('Authorization', `Bearer ${tokenSemAssinatura}`)
        .send({ faixa: 'ATE_150' })
        .expect(409);

      await request(app.getHttpServer())
        .delete('/api/assinaturas')
        .set('Authorization', `Bearer ${tokenSemAssinatura}`)
        .expect(409);
    });

    it('PATCH /assinaturas troca a faixa com o preço correto, sem cancelar/recriar', async () => {
      mercadoPagoMock.atualizarValorAssinatura.mockClear();

      const resposta = await request(app.getHttpServer())
        .patch('/api/assinaturas')
        .set('Authorization', `Bearer ${token}`)
        .send({ faixa: 'ACIMA_250' })
        .expect(200);

      expect(mercadoPagoMock.atualizarValorAssinatura).toHaveBeenCalledWith(
        PREAPPROVAL_ID,
        21990,
      );
      expect(resposta.body).toMatchObject({ faixaAssinatura: 'ACIMA_250' });

      const restaurante = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      expect(restaurante.faixaAssinatura).toBe('ACIMA_250');
    });

    it('DELETE /assinaturas cancela no Mercado Pago e marca CANCELED de forma síncrona', async () => {
      mercadoPagoMock.cancelarAssinatura.mockClear();

      await request(app.getHttpServer())
        .delete('/api/assinaturas')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(mercadoPagoMock.cancelarAssinatura).toHaveBeenCalledWith(
        PREAPPROVAL_ID,
      );

      const restaurante = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      expect(restaurante.statusAssinatura).toBe('CANCELED');
    });
  });
});
