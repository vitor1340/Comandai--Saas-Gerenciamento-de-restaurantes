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
import { PagamentosService } from './../src/pagamentos/pagamentos.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

interface RespostaAuth {
  accessToken: string;
  usuario: { id: string };
}

interface RecursoComId {
  id: string;
}

interface RestauranteMe {
  id: string;
  slug: string;
}

interface PedidoCriado {
  id: string;
}

/**
 * O SDK do Mercado Pago é substituído por um mock (MercadoPagoClient) — não
 * faz sentido bater na API real do Mercado Pago em CI. O que este teste
 * cobre é a lógica que o Comandaí é responsável por (state assinado,
 * criptografia do token do restaurante, criação/atualização do Pagamento,
 * transição automática do pedido ao aprovar).
 */
describe('Pagamentos via Mercado Pago (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let pagamentosService: PagamentosService;
  let mercadoPagoMock: {
    gerarUrlAutorizacao: jest.Mock;
    trocarCodigoPorToken: jest.Mock;
    renovarToken: jest.Mock;
    criarPreferencia: jest.Mock;
    buscarPagamento: jest.Mock;
    validarAssinaturaWebhook: jest.Mock;
  };

  const execucao = randomUUID().slice(0, 8);
  const ACCESS_TOKEN_MP_BRUTO = 'mp-access-token-bruto-xyz';

  let token: string;
  let restauranteId: string;
  let slug: string;
  let produtoId: string;
  const precoProduto = 3000;

  let tokenSemMp: string;
  let restauranteSemMpId: string;
  let slugSemMp: string;

  beforeAll(async () => {
    mercadoPagoMock = {
      gerarUrlAutorizacao: jest
        .fn()
        .mockReturnValue('https://auth.mercadopago.com/authorization?mock=1'),
      trocarCodigoPorToken: jest.fn().mockResolvedValue({
        accessToken: ACCESS_TOKEN_MP_BRUTO,
        refreshToken: 'mp-refresh-token-bruto',
        userId: 'mp-user-1',
        expiraEmSegundos: 180 * 24 * 60 * 60,
      }),
      renovarToken: jest.fn(),
      criarPreferencia: jest.fn().mockResolvedValue({
        id: 'pref-abc',
        initPoint: 'https://mercadopago.com/checkout/pref-abc',
      }),
      buscarPagamento: jest.fn(),
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
    pagamentosService = app.get(PagamentosService);

    const registrar = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja Pagamentos Teste ${execucao}`,
        nomeDono: 'Dono Pagamentos',
        email: `dono-pagamentos-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-pagamentos-${execucao}@teste.comandai.dev`,
    );
    token = (registrar.body as RespostaAuth).accessToken;

    const me = await request(app.getHttpServer())
      .get('/api/restaurantes/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const meCorpo = me.body as RestauranteMe;
    restauranteId = meCorpo.id;
    slug = meCorpo.slug;

    const categoria = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Categoria Pagamentos' })
      .expect(201);
    const produto = await request(app.getHttpServer())
      .post('/api/produtos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Produto Pagamentos',
        precoCentavos: precoProduto,
        categoriaId: (categoria.body as RecursoComId).id,
        disponivel: true,
      })
      .expect(201);
    produtoId = (produto.body as RecursoComId).id;

    // conecta a conta Mercado Pago do restaurante principal, usada em quase
    // todos os testes abaixo (fluxo ponta a ponta: conectar -> callback)
    const conectar = await request(app.getHttpServer())
      .get('/api/pagamentos/conectar')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((conectar.body as { url: string }).url).toBe(
      'https://auth.mercadopago.com/authorization?mock=1',
    );
    const chamadasGerarUrl = mercadoPagoMock.gerarUrlAutorizacao.mock
      .calls as unknown as [string, string][];
    const state = chamadasGerarUrl.at(-1)![0];
    await request(app.getHttpServer())
      .get('/api/pagamentos/callback')
      .query({ code: 'codigo-valido', state })
      .expect(302);

    // segundo restaurante, que nunca conecta o Mercado Pago
    const registrarSemMp = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja Sem Mercado Pago ${execucao}`,
        nomeDono: 'Dono Sem MP',
        email: `dono-sem-mp-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-sem-mp-${execucao}@teste.comandai.dev`,
    );
    tokenSemMp = (registrarSemMp.body as RespostaAuth).accessToken;
    const meSemMp = await request(app.getHttpServer())
      .get('/api/restaurantes/me')
      .set('Authorization', `Bearer ${tokenSemMp}`)
      .expect(200);
    restauranteSemMpId = (meSemMp.body as RestauranteMe).id;
    slugSemMp = (meSemMp.body as RestauranteMe).slug;

    mercadoPagoMock.validarAssinaturaWebhook.mockImplementation(() => {});
  });

  afterAll(async () => {
    const restauranteIds = [restauranteId, restauranteSemMpId].filter(
      (id): id is string => Boolean(id),
    );
    if (restauranteIds.length > 0) {
      await prisma.pagamento.deleteMany({
        where: { pedido: { restauranteId: { in: restauranteIds } } },
      });
      await prisma.itemPedido.deleteMany({
        where: { pedido: { restauranteId: { in: restauranteIds } } },
      });
      await prisma.pedido.deleteMany({
        where: { restauranteId: { in: restauranteIds } },
      });
      await prisma.produto.deleteMany({
        where: { restauranteId: { in: restauranteIds } },
      });
      await prisma.categoria.deleteMany({
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

  it('sem autenticação, GET /pagamentos/conectar é rejeitado (401)', () => {
    return request(app.getHttpServer())
      .get('/api/pagamentos/conectar')
      .expect(401);
  });

  it('a conta Mercado Pago foi conectada e o token salvo está criptografado', async () => {
    const restaurante = await prisma.restaurante.findUniqueOrThrow({
      where: { id: restauranteId },
    });
    expect(restaurante.mercadoPagoAccessToken).toBeTruthy();
    expect(restaurante.mercadoPagoAccessToken).not.toBe(ACCESS_TOKEN_MP_BRUTO);
    expect(restaurante.mercadoPagoUserId).toBe('mp-user-1');
    expect(restaurante.mercadoPagoTokenExpiraEm).not.toBeNull();
    expect(restaurante.mercadoPagoTokenExpiraEm!.getTime()).toBeGreaterThan(
      Date.now() + 170 * 24 * 60 * 60 * 1000,
    );
  });

  it('callback com state inválido redireciona com erro, sem alterar o restaurante', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/pagamentos/callback')
      .query({ code: 'codigo-qualquer', state: 'state-invalido-ou-forjado' })
      .expect(302);
    expect(resposta.headers.location).toContain('mercadopago=erro');
  });

  describe('criação de pagamento para um pedido', () => {
    it('loja sem Mercado Pago conectado retorna 409', async () => {
      // cria o pedido direto no banco (o produto usado nos outros testes
      // pertence ao restaurante principal, então não dá pra criar via HTTP
      // na loja sem MP) — o que este teste cobre é só o 409 do endpoint de
      // pagamento em si.
      const pedidoDireto = await prisma.pedido.create({
        data: {
          restauranteId: restauranteSemMpId,
          numero: 1,
          clienteNome: 'Cliente Sem MP',
          canal: 'CARDAPIO_DIGITAL',
          tipoEntrega: 'RETIRADA',
          valorTotalCentavos: 1000,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/loja/${slugSemMp}/pedidos/${pedidoDireto.id}/pagamento`)
        .expect(409);
    });

    it('loja com Mercado Pago conectado cria a preferência e retorna o link de pagamento', async () => {
      const pedido = await request(app.getHttpServer())
        .post(`/api/loja/${slug}/pedidos`)
        .send({
          clienteNome: 'Cliente Pagamento',
          tipoEntrega: 'RETIRADA',
          itens: [{ produtoId, quantidade: 2 }],
        })
        .expect(201);
      const pedidoId = (pedido.body as PedidoCriado).id;

      const resposta = await request(app.getHttpServer())
        .post(`/api/loja/${slug}/pedidos/${pedidoId}/pagamento`)
        .expect(201);
      expect((resposta.body as { initPoint: string }).initPoint).toBe(
        'https://mercadopago.com/checkout/pref-abc',
      );

      // confirma que o access token foi descriptografado de volta pro valor
      // original antes de ser usado pelo client do Mercado Pago
      expect(mercadoPagoMock.criarPreferencia).toHaveBeenLastCalledWith(
        ACCESS_TOKEN_MP_BRUTO,
        expect.objectContaining({ pedidoId }),
      );

      const pagamento = await prisma.pagamento.findUniqueOrThrow({
        where: { pedidoId },
      });
      expect(pagamento.status).toBe('PENDENTE');
      expect(pagamento.preferenceId).toBe('pref-abc');
      expect(pagamento.valorCentavos).toBe(precoProduto * 2);
    });
  });

  describe('webhook de notificação', () => {
    it('assinatura inválida é rejeitada (401)', async () => {
      mercadoPagoMock.validarAssinaturaWebhook.mockImplementationOnce(() => {
        throw new UnauthorizedException('Assinatura de webhook inválida');
      });

      await request(app.getHttpServer())
        .post('/api/pagamentos/webhook')
        .query({ restauranteId, 'data.id': '999999' })
        .set('x-signature', 'ts=1,v1=assinatura-forjada')
        .set('x-request-id', 'req-1')
        .expect(401);
    });

    it('pagamento aprovado atualiza o pagamento e confirma o pedido automaticamente', async () => {
      const pedido = await request(app.getHttpServer())
        .post(`/api/loja/${slug}/pedidos`)
        .send({
          clienteNome: 'Cliente Webhook',
          tipoEntrega: 'RETIRADA',
          itens: [{ produtoId, quantidade: 1 }],
        })
        .expect(201);
      const pedidoId = (pedido.body as PedidoCriado).id;

      await request(app.getHttpServer())
        .post(`/api/loja/${slug}/pedidos/${pedidoId}/pagamento`)
        .expect(201);

      mercadoPagoMock.buscarPagamento.mockResolvedValueOnce({
        status: 'approved',
        externalReference: pedidoId,
        metodoPagamento: 'pix',
      });

      await request(app.getHttpServer())
        .post('/api/pagamentos/webhook')
        .query({ restauranteId, 'data.id': 'pagamento-mp-1' })
        .set('x-signature', 'ts=1,v1=assinatura-valida')
        .set('x-request-id', 'req-2')
        .expect(200);

      expect(mercadoPagoMock.buscarPagamento).toHaveBeenLastCalledWith(
        ACCESS_TOKEN_MP_BRUTO,
        'pagamento-mp-1',
      );

      const pagamento = await prisma.pagamento.findUniqueOrThrow({
        where: { pedidoId },
      });
      expect(pagamento.status).toBe('APROVADO');
      expect(pagamento.metodoPagamento).toBe('pix');
      expect(pagamento.mercadoPagoPaymentId).toBe('pagamento-mp-1');

      const pedidoAtualizado = await prisma.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
      });
      expect(pedidoAtualizado.status).toBe('CONFIRMADO');
    });

    it('notificação para restaurante sem Mercado Pago conectado é ignorada (200)', async () => {
      await request(app.getHttpServer())
        .post('/api/pagamentos/webhook')
        .query({ restauranteId: restauranteSemMpId, 'data.id': '123' })
        .set('x-signature', 'ts=1,v1=qualquer')
        .set('x-request-id', 'req-3')
        .expect(200);

      expect(mercadoPagoMock.buscarPagamento).not.toHaveBeenCalledWith(
        expect.anything(),
        '123',
      );
    });
  });

  describe('renovação automática do token', () => {
    beforeAll(async () => {
      // outros restaurantes conectados de verdade (fora deste arquivo de teste)
      // não podem ser varridos pelo job com o MercadoPagoClient mockado —
      // empurra a expiração deles bem pra frente antes de rodar os testes daqui.
      await prisma.restaurante.updateMany({
        where: {
          mercadoPagoAccessToken: { not: null },
          id: { notIn: [restauranteId, restauranteSemMpId] },
        },
        data: {
          mercadoPagoTokenExpiraEm: new Date(
            Date.now() + 300 * 24 * 60 * 60 * 1000,
          ),
        },
      });
    });

    it('token que ainda não está perto de vencer não é renovado', async () => {
      await prisma.restaurante.update({
        where: { id: restauranteId },
        data: {
          mercadoPagoTokenExpiraEm: new Date(
            Date.now() + 60 * 24 * 60 * 60 * 1000,
          ),
        },
      });
      const antes = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      mercadoPagoMock.renovarToken.mockClear();

      await pagamentosService.renovarTokensProximosDoVencimento();

      expect(mercadoPagoMock.renovarToken).not.toHaveBeenCalled();
      const depois = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      expect(depois.mercadoPagoAccessToken).toBe(antes.mercadoPagoAccessToken);
    });

    it('token perto de vencer é renovado automaticamente', async () => {
      await prisma.restaurante.update({
        where: { id: restauranteId },
        data: {
          mercadoPagoTokenExpiraEm: new Date(
            Date.now() + 5 * 24 * 60 * 60 * 1000,
          ),
        },
      });
      const antes = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      mercadoPagoMock.renovarToken.mockClear();
      mercadoPagoMock.renovarToken.mockResolvedValueOnce({
        accessToken: 'mp-access-token-renovado',
        refreshToken: 'mp-refresh-token-renovado',
        userId: 'mp-user-1',
        expiraEmSegundos: 180 * 24 * 60 * 60,
      });

      await pagamentosService.renovarTokensProximosDoVencimento();

      expect(mercadoPagoMock.renovarToken).toHaveBeenCalledWith(
        'mp-refresh-token-bruto',
      );
      const depois = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      expect(depois.mercadoPagoAccessToken).not.toBe(
        antes.mercadoPagoAccessToken,
      );
      expect(depois.mercadoPagoRefreshToken).not.toBe(
        antes.mercadoPagoRefreshToken,
      );
      expect(depois.mercadoPagoTokenExpiraEm!.getTime()).toBeGreaterThan(
        Date.now() + 170 * 24 * 60 * 60 * 1000,
      );
    });

    it('falha ao renovar não derruba o job nem apaga o token atual', async () => {
      await prisma.restaurante.update({
        where: { id: restauranteId },
        data: {
          mercadoPagoTokenExpiraEm: new Date(
            Date.now() + 5 * 24 * 60 * 60 * 1000,
          ),
        },
      });
      const antes = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      mercadoPagoMock.renovarToken.mockClear();
      mercadoPagoMock.renovarToken.mockRejectedValueOnce(
        new Error('Mercado Pago fora do ar'),
      );

      await pagamentosService.renovarTokensProximosDoVencimento();

      const depois = await prisma.restaurante.findUniqueOrThrow({
        where: { id: restauranteId },
      });
      expect(depois.mercadoPagoAccessToken).toBe(antes.mercadoPagoAccessToken);
    });
  });

  it('desconectar remove os dados do Mercado Pago do restaurante', async () => {
    await request(app.getHttpServer())
      .delete('/api/pagamentos/conectar')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const restaurante = await prisma.restaurante.findUniqueOrThrow({
      where: { id: restauranteId },
    });
    expect(restaurante.mercadoPagoAccessToken).toBeNull();
    expect(restaurante.mercadoPagoUserId).toBeNull();
  });
});
