import 'dotenv/config';
import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
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
  numero: number;
  status: string;
  valorTotalCentavos: number;
}

/**
 * Cobre o loop de pedidos fechado na Fase 2: criação pública com preço
 * recalculado no backend, idempotência, restaurante fechado e a máquina de
 * estados de status.
 */
describe('Pedidos públicos e transições de status (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let token: string;
  let usuarioId: string;
  let restauranteId: string;
  let slug: string;
  let categoriaId: string;
  let produtoDisponivelId: string;
  let produtoIndisponivelId: string;
  const precoProdutoDisponivel = 2500;

  // segundo restaurante, só para o teste de isolamento entre tenants
  let tokenOutro: string;
  let usuarioOutroId: string;
  let restauranteOutroId: string;
  let produtoOutroId: string;

  const execucao = randomUUID().slice(0, 8);

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

    const registrar = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja Pedidos Teste ${execucao}`,
        nomeDono: 'Dono Pedidos',
        email: `dono-pedidos-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-pedidos-${execucao}@teste.comandai.dev`,
    );
    const corpo = registrar.body as RespostaAuth;
    token = corpo.accessToken;
    usuarioId = corpo.usuario.id;

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
    });
    restauranteId = usuario.restauranteId;

    const me = await request(app.getHttpServer())
      .get('/api/restaurantes/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    slug = (me.body as RestauranteMe).slug;

    const categoria = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Categoria Pedidos' })
      .expect(201);
    categoriaId = (categoria.body as RecursoComId).id;

    const produtoDisponivel = await request(app.getHttpServer())
      .post('/api/produtos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Produto Disponível',
        precoCentavos: precoProdutoDisponivel,
        categoriaId,
        disponivel: true,
      })
      .expect(201);
    produtoDisponivelId = (produtoDisponivel.body as RecursoComId).id;

    const produtoIndisponivel = await request(app.getHttpServer())
      .post('/api/produtos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Produto Indisponível',
        precoCentavos: 9999,
        categoriaId,
        disponivel: false,
      })
      .expect(201);
    produtoIndisponivelId = (produtoIndisponivel.body as RecursoComId).id;

    // restaurante B, usado só para confirmar que produtos de outro tenant são rejeitados
    const registrarOutro = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja Pedidos Teste B ${execucao}`,
        nomeDono: 'Dono B',
        email: `dono-pedidos-b-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-pedidos-b-${execucao}@teste.comandai.dev`,
    );
    const corpoOutro = registrarOutro.body as RespostaAuth;
    tokenOutro = corpoOutro.accessToken;
    usuarioOutroId = corpoOutro.usuario.id;
    const usuarioOutro = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioOutroId },
    });
    restauranteOutroId = usuarioOutro.restauranteId;

    const categoriaOutro = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${tokenOutro}`)
      .send({ nome: 'Categoria Outro Tenant' })
      .expect(201);
    const produtoOutro = await request(app.getHttpServer())
      .post('/api/produtos')
      .set('Authorization', `Bearer ${tokenOutro}`)
      .send({
        nome: 'Produto de outro restaurante',
        precoCentavos: 1000,
        categoriaId: (categoriaOutro.body as RecursoComId).id,
        disponivel: true,
      })
      .expect(201);
    produtoOutroId = (produtoOutro.body as RecursoComId).id;
  });

  afterAll(async () => {
    // se o beforeAll falhar no meio (ex.: timeout), algum desses ids pode
    // nunca ter sido setado — sem esse filtro, o Prisma rejeita `undefined`
    // dentro de um `in` e a limpeza quebra, mascarando o erro original.
    const restauranteIds = [restauranteId, restauranteOutroId].filter(
      (id): id is string => Boolean(id),
    );
    if (restauranteIds.length === 0) {
      await app?.close();
      return;
    }

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
    await app.close();
  });

  it('recalcula o preço no backend e ignora preço/total enviado pelo cliente', async () => {
    const resposta = await request(app.getHttpServer())
      .post(`/api/loja/${slug}/pedidos`)
      .send({
        clienteNome: 'Cliente Teste',
        tipoEntrega: 'DELIVERY',
        itens: [
          {
            produtoId: produtoDisponivelId,
            quantidade: 2,
            // campos abaixo não existem no DTO e devem ser descartados pelo whitelist
            precoCentavos: 1,
            precoUnitarioCentavos: 1,
          },
        ],
      })
      .expect(201);

    const pedido = resposta.body as PedidoCriado;
    expect(pedido.valorTotalCentavos).toBe(precoProdutoDisponivel * 2);
    expect(pedido.status).toBe('NOVO');
    expect(pedido.numero).toBeGreaterThan(0);
  });

  it('rejeita item indisponível (400)', () => {
    return request(app.getHttpServer())
      .post(`/api/loja/${slug}/pedidos`)
      .send({
        clienteNome: 'Cliente Teste',
        tipoEntrega: 'DELIVERY',
        itens: [{ produtoId: produtoIndisponivelId, quantidade: 1 }],
      })
      .expect(400);
  });

  it('rejeita produto de outro restaurante (400)', () => {
    return request(app.getHttpServer())
      .post(`/api/loja/${slug}/pedidos`)
      .send({
        clienteNome: 'Cliente Teste',
        tipoEntrega: 'DELIVERY',
        itens: [{ produtoId: produtoOutroId, quantidade: 1 }],
      })
      .expect(400);
  });

  it('é idempotente: a mesma chave não cria dois pedidos', async () => {
    const chaveIdempotencia = `idem-${randomUUID()}`;
    const payload = {
      clienteNome: 'Cliente Idempotente',
      tipoEntrega: 'RETIRADA',
      itens: [{ produtoId: produtoDisponivelId, quantidade: 1 }],
      chaveIdempotencia,
    };

    const primeira = await request(app.getHttpServer())
      .post(`/api/loja/${slug}/pedidos`)
      .send(payload)
      .expect(201);
    const segunda = await request(app.getHttpServer())
      .post(`/api/loja/${slug}/pedidos`)
      .send(payload)
      .expect(201);

    const pedidoPrimeira = primeira.body as PedidoCriado;
    const pedidoSegunda = segunda.body as PedidoCriado;
    expect(pedidoSegunda.id).toBe(pedidoPrimeira.id);
    expect(pedidoSegunda.numero).toBe(pedidoPrimeira.numero);

    const totalComEssaChave = await prisma.pedido.count({
      where: { restauranteId, chaveIdempotencia },
    });
    expect(totalComEssaChave).toBe(1);
  });

  it('rejeita pedido quando a loja está fechada (409)', async () => {
    await prisma.restaurante.update({
      where: { id: restauranteId },
      data: { aberto: false },
    });
    try {
      await request(app.getHttpServer())
        .post(`/api/loja/${slug}/pedidos`)
        .send({
          clienteNome: 'Cliente Teste',
          tipoEntrega: 'DELIVERY',
          itens: [{ produtoId: produtoDisponivelId, quantidade: 1 }],
        })
        .expect(409);
    } finally {
      await prisma.restaurante.update({
        where: { id: restauranteId },
        data: { aberto: true },
      });
    }
  });

  it('rejeita pedido quando o restaurante não tem plano ativo (409)', async () => {
    await prisma.restaurante.update({
      where: { id: restauranteId },
      data: { statusAssinatura: 'CANCELED' },
    });
    try {
      await request(app.getHttpServer())
        .post(`/api/loja/${slug}/pedidos`)
        .send({
          clienteNome: 'Cliente Teste',
          tipoEntrega: 'DELIVERY',
          itens: [{ produtoId: produtoDisponivelId, quantidade: 1 }],
        })
        .expect(409);
    } finally {
      await prisma.restaurante.update({
        where: { id: restauranteId },
        data: { statusAssinatura: 'TRIALING' },
      });
    }
  });

  describe('transições de status', () => {
    let pedidoId: string;

    beforeAll(async () => {
      const resposta = await request(app.getHttpServer())
        .post(`/api/loja/${slug}/pedidos`)
        .send({
          clienteNome: 'Cliente Status',
          tipoEntrega: 'DELIVERY',
          itens: [{ produtoId: produtoDisponivelId, quantidade: 1 }],
        })
        .expect(201);
      pedidoId = (resposta.body as PedidoCriado).id;
    });

    it('não permite pular direto de NOVO para PRONTO (409)', () => {
      return request(app.getHttpServer())
        .patch(`/api/pedidos/${pedidoId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'PRONTO' })
        .expect(409);
    });

    it('não permite outro restaurante alterar o status (404)', () => {
      return request(app.getHttpServer())
        .patch(`/api/pedidos/${pedidoId}/status`)
        .set('Authorization', `Bearer ${tokenOutro}`)
        .send({ status: 'CONFIRMADO' })
        .expect(404);
    });

    it('permite avançar a sequência válida de status', async () => {
      await request(app.getHttpServer())
        .patch(`/api/pedidos/${pedidoId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'CONFIRMADO' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/pedidos/${pedidoId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'EM_PREPARO' })
        .expect(200);
      const final = await request(app.getHttpServer())
        .patch(`/api/pedidos/${pedidoId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'PRONTO' })
        .expect(200);

      expect((final.body as PedidoCriado).status).toBe('PRONTO');
    });

    it('não permite voltar de um status já avançado (409)', () => {
      return request(app.getHttpServer())
        .patch(`/api/pedidos/${pedidoId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'NOVO' })
        .expect(409);
    });
  });
});
