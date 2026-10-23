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

interface CategoriaResposta {
  id: string;
  nome: string;
  slug: string;
  ordem: number;
  ativa: boolean;
  produtosCount: number;
}

interface ProdutoResposta {
  id: string;
  categoriaId: string | null;
}

/**
 * Cobre o CRUD evoluído de categorias: slug gerado/deduplicado no backend,
 * ativa/inativa, reordenação, e o fluxo de exclusão que nunca apaga produtos
 * em cascata (move ou desvincula, sempre com decisão explícita).
 */
describe('Categorias (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let token: string;
  let restauranteId: string;

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
        nomeRestaurante: `Loja Categorias Teste ${execucao}`,
        nomeDono: 'Dono Categorias',
        email: `dono-categorias-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(201);
    await marcarEmailVerificado(
      prisma,
      `dono-categorias-${execucao}@teste.comandai.dev`,
    );
    const corpo = registrar.body as RespostaAuth;
    token = corpo.accessToken;

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: corpo.usuario.id },
    });
    restauranteId = usuario.restauranteId;
  });

  afterAll(async () => {
    if (restauranteId) {
      await prisma.produto.deleteMany({ where: { restauranteId } });
      await prisma.categoria.deleteMany({ where: { restauranteId } });
      await prisma.usuario.deleteMany({ where: { restauranteId } });
      await prisma.restaurante.deleteMany({ where: { id: restauranteId } });
    }
    await app.close();
  });

  it('cria categoria com slug gerado a partir do nome', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Bebidas Geladas' })
      .expect(201);

    const categoria = resposta.body as CategoriaResposta;
    expect(categoria.slug).toBe('bebidas-geladas');
    expect(categoria.ativa).toBe(true);
    expect(categoria.produtosCount).toBeUndefined(); // criar() não inclui _count, só listar()
  });

  it('deduplica o slug quando duas categorias geram o mesmo slug base', async () => {
    await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Sobremesas' })
      .expect(201);

    const segunda = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Sobremesas!!!' }) // slugify remove símbolos -> mesma base "sobremesas"
      .expect(201);

    expect((segunda.body as CategoriaResposta).slug).toBe('sobremesas-2');
  });

  it('renomear a categoria regenera o slug', async () => {
    const criada = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Entradas' })
      .expect(201);
    const id = (criada.body as CategoriaResposta).id;

    const atualizada = await request(app.getHttpServer())
      .patch(`/api/categorias/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Aperitivos' })
      .expect(200);

    expect((atualizada.body as CategoriaResposta).slug).toBe('aperitivos');
  });

  it('listar retorna produtosCount por categoria', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const categorias = resposta.body as CategoriaResposta[];
    expect(categorias.length).toBeGreaterThan(0);
    for (const categoria of categorias) {
      expect(typeof categoria.produtosCount).toBe('number');
    }
  });

  it('desativa e reativa uma categoria via PATCH ativa', async () => {
    const criada = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Categoria Sazonal' })
      .expect(201);
    const id = (criada.body as CategoriaResposta).id;

    const desativada = await request(app.getHttpServer())
      .patch(`/api/categorias/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ativa: false })
      .expect(200);
    expect((desativada.body as CategoriaResposta).ativa).toBe(false);

    const reativada = await request(app.getHttpServer())
      .patch(`/api/categorias/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ativa: true })
      .expect(200);
    expect((reativada.body as CategoriaResposta).ativa).toBe(true);
  });

  describe('produto sem categoria', () => {
    it('cria produto sem categoriaId', async () => {
      const resposta = await request(app.getHttpServer())
        .post('/api/produtos')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Produto Avulso', precoCentavos: 1000 })
        .expect(201);

      expect((resposta.body as ProdutoResposta).categoriaId).toBeNull();
    });

    it('desvincula um produto de sua categoria enviando categoriaId: null', async () => {
      const categoria = await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Categoria Para Desvincular' })
        .expect(201);
      const categoriaId = (categoria.body as CategoriaResposta).id;

      const produto = await request(app.getHttpServer())
        .post('/api/produtos')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Produto Vinculado', precoCentavos: 500, categoriaId })
        .expect(201);
      const produtoId = (produto.body as ProdutoResposta).id;

      const desvinculado = await request(app.getHttpServer())
        .patch(`/api/produtos/${produtoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ categoriaId: null })
        .expect(200);

      expect((desvinculado.body as ProdutoResposta).categoriaId).toBeNull();
    });
  });

  describe('exclusão de categoria', () => {
    it('exclui direto quando a categoria não tem produtos vinculados', async () => {
      const categoria = await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Categoria Vazia' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/categorias/${(categoria.body as CategoriaResposta).id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('rejeita a exclusão (409) quando há produtos vinculados e nenhuma decisão foi informada', async () => {
      const categoria = await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Categoria Com Produto' })
        .expect(201);
      const categoriaId = (categoria.body as CategoriaResposta).id;

      await request(app.getHttpServer())
        .post('/api/produtos')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Produto X', precoCentavos: 100, categoriaId })
        .expect(201);

      const resposta = await request(app.getHttpServer())
        .delete(`/api/categorias/${categoriaId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      expect(resposta.body).toMatchObject({ produtosVinculados: 1 });
    });

    it('move os produtos para outra categoria e então exclui', async () => {
      const origem = await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Categoria Origem' })
        .expect(201);
      const destino = await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Categoria Destino' })
        .expect(201);
      const origemId = (origem.body as CategoriaResposta).id;
      const destinoId = (destino.body as CategoriaResposta).id;

      const produto = await request(app.getHttpServer())
        .post('/api/produtos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nome: 'Produto Movido',
          precoCentavos: 100,
          categoriaId: origemId,
        })
        .expect(201);
      const produtoId = (produto.body as ProdutoResposta).id;

      await request(app.getHttpServer())
        .delete(`/api/categorias/${origemId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ moverProdutosParaCategoriaId: destinoId })
        .expect(200);

      const produtoAtualizado = await prisma.produto.findUniqueOrThrow({
        where: { id: produtoId },
      });
      expect(produtoAtualizado.categoriaId).toBe(destinoId);

      const categoriaExcluida = await prisma.categoria.findUnique({
        where: { id: origemId },
      });
      expect(categoriaExcluida).toBeNull();
    });

    it('desvincula os produtos (ficam sem categoria) e então exclui', async () => {
      const categoria = await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Categoria A Desvincular' })
        .expect(201);
      const categoriaId = (categoria.body as CategoriaResposta).id;

      const produto = await request(app.getHttpServer())
        .post('/api/produtos')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Produto Desvinculado', precoCentavos: 100, categoriaId })
        .expect(201);
      const produtoId = (produto.body as ProdutoResposta).id;

      await request(app.getHttpServer())
        .delete(`/api/categorias/${categoriaId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ desvincularProdutos: true })
        .expect(200);

      const produtoAtualizado = await prisma.produto.findUniqueOrThrow({
        where: { id: produtoId },
      });
      expect(produtoAtualizado.categoriaId).toBeNull();
    });
  });

  describe('reordenação', () => {
    let categoriaTopoId: string;
    let categoriaMeioId: string;
    let categoriaFimId: string;

    beforeAll(async () => {
      // Zera as categorias existentes desse restaurante pra ter ordem previsível
      await prisma.produto.deleteMany({ where: { restauranteId } });
      await prisma.categoria.deleteMany({ where: { restauranteId } });

      const topo = await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Topo', ordem: 0 })
        .expect(201);
      const meio = await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Meio', ordem: 1 })
        .expect(201);
      const fim = await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Fim', ordem: 2 })
        .expect(201);

      categoriaTopoId = (topo.body as CategoriaResposta).id;
      categoriaMeioId = (meio.body as CategoriaResposta).id;
      categoriaFimId = (fim.body as CategoriaResposta).id;
    });

    it('mover BAIXO troca a ordem com a categoria seguinte', async () => {
      await request(app.getHttpServer())
        .patch(`/api/categorias/${categoriaTopoId}/reordenar`)
        .set('Authorization', `Bearer ${token}`)
        .send({ direcao: 'BAIXO' })
        .expect(200);

      const topo = await prisma.categoria.findUniqueOrThrow({
        where: { id: categoriaTopoId },
      });
      const meio = await prisma.categoria.findUniqueOrThrow({
        where: { id: categoriaMeioId },
      });
      expect(topo.ordem).toBe(1);
      expect(meio.ordem).toBe(0);
    });

    it('mover CIMA na primeira posição não faz nada (sem erro)', async () => {
      // depois do teste anterior, categoriaMeioId está na posição 0 (primeira)
      await request(app.getHttpServer())
        .patch(`/api/categorias/${categoriaMeioId}/reordenar`)
        .set('Authorization', `Bearer ${token}`)
        .send({ direcao: 'CIMA' })
        .expect(200);

      const meio = await prisma.categoria.findUniqueOrThrow({
        where: { id: categoriaMeioId },
      });
      expect(meio.ordem).toBe(0);
    });

    it('mover BAIXO na última posição não faz nada (sem erro)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/categorias/${categoriaFimId}/reordenar`)
        .set('Authorization', `Bearer ${token}`)
        .send({ direcao: 'BAIXO' })
        .expect(200);

      const fim = await prisma.categoria.findUniqueOrThrow({
        where: { id: categoriaFimId },
      });
      expect(fim.ordem).toBe(2);
    });
  });
});
