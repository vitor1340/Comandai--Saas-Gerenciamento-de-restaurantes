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

/**
 * Garante que um restaurante nunca consegue ler, alterar ou excluir dados
 * (categorias/produtos) de outro restaurante, mesmo autenticado.
 */
describe('Isolamento de tenant (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let tokenA: string;
  let tokenB: string;
  let usuarioAId: string;
  let usuarioBId: string;
  let restauranteAId: string;
  let restauranteBId: string;
  let categoriaAId: string;
  let produtoAId: string;

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

    const registrarA = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Tenant Teste A ${execucao}`,
        nomeDono: 'Dono A',
        email: `dono-a-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-a-${execucao}@teste.comandai.dev`,
    );
    const corpoA = registrarA.body as RespostaAuth;
    tokenA = corpoA.accessToken;
    usuarioAId = corpoA.usuario.id;

    const registrarB = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Tenant Teste B ${execucao}`,
        nomeDono: 'Dono B',
        email: `dono-b-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-b-${execucao}@teste.comandai.dev`,
    );
    const corpoB = registrarB.body as RespostaAuth;
    tokenB = corpoB.accessToken;
    usuarioBId = corpoB.usuario.id;

    const usuarioA = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioAId },
    });
    const usuarioB = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioBId },
    });
    restauranteAId = usuarioA.restauranteId;
    restauranteBId = usuarioB.restauranteId;

    const categoria = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ nome: 'Categoria do Tenant A' })
      .expect(201);
    categoriaAId = (categoria.body as RecursoComId).id;

    const produto = await request(app.getHttpServer())
      .post('/api/produtos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        nome: 'Produto do Tenant A',
        precoCentavos: 1000,
        categoriaId: categoriaAId,
      })
      .expect(201);
    produtoAId = (produto.body as RecursoComId).id;
  });

  afterAll(async () => {
    await prisma.produto.deleteMany({
      where: { restauranteId: restauranteAId },
    });
    await prisma.categoria.deleteMany({
      where: { restauranteId: restauranteAId },
    });
    await prisma.usuario.deleteMany({
      where: { restauranteId: { in: [restauranteAId, restauranteBId] } },
    });
    await prisma.restaurante.deleteMany({
      where: { id: { in: [restauranteAId, restauranteBId] } },
    });
    await app.close();
  });

  it('não lista categorias de outro restaurante', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/categorias')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const categorias = resposta.body as RecursoComId[];
    expect(categorias.find((c) => c.id === categoriaAId)).toBeUndefined();
  });

  it('não lista produtos de outro restaurante', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/produtos')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const produtos = resposta.body as RecursoComId[];
    expect(produtos.find((p) => p.id === produtoAId)).toBeUndefined();
  });

  it('não permite editar categoria de outro restaurante (404)', () => {
    return request(app.getHttpServer())
      .patch(`/api/categorias/${categoriaAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ nome: 'Categoria sequestrada' })
      .expect(404);
  });

  it('não permite excluir categoria de outro restaurante (404)', () => {
    return request(app.getHttpServer())
      .delete(`/api/categorias/${categoriaAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('não permite editar produto de outro restaurante (404)', () => {
    return request(app.getHttpServer())
      .patch(`/api/produtos/${produtoAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ nome: 'Produto sequestrado' })
      .expect(404);
  });

  it('não permite excluir produto de outro restaurante (404)', () => {
    return request(app.getHttpServer())
      .delete(`/api/produtos/${produtoAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('não permite criar produto vinculado a categoria de outro restaurante (404)', () => {
    return request(app.getHttpServer())
      .post('/api/produtos')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        nome: 'Produto com categoria alheia',
        precoCentavos: 500,
        categoriaId: categoriaAId,
      })
      .expect(404);
  });

  it('token de um restaurante não acessa /restaurantes/me de outro restaurante', async () => {
    const respostaA = await request(app.getHttpServer())
      .get('/api/restaurantes/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const respostaB = await request(app.getHttpServer())
      .get('/api/restaurantes/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const corpoA = respostaA.body as RecursoComId;
    const corpoB = respostaB.body as RecursoComId;
    expect(corpoA.id).toBe(restauranteAId);
    expect(corpoB.id).toBe(restauranteBId);
    expect(corpoA.id).not.toBe(corpoB.id);
  });
});
