import 'dotenv/config';
import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/auth/auth.service';
import { EmailService } from './../src/auth/email.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { assertTokensCompletos } from './helpers/assert-tokens-completos';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

interface RespostaAuth {
  accessToken: string;
  usuario: { id: string };
}

/**
 * Barreiras contra abuso do teste grátis e contas problemáticas: CPF/CNPJ
 * válido e único no cadastro, e-mail verificado, onboarding de documento
 * pra quem entra com Google, suspensão pelo admin e o painel de admin.
 */
describe('Anti-abuso de cadastro (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let authService: AuthService;
  const linksVerificacao: string[] = [];

  const execucao = randomUUID().slice(0, 8);
  const restaurantesCriados: string[] = [];
  const usuariosCriados: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue({
        enviarEmailRedefinicaoSenha: jest.fn().mockResolvedValue(undefined),
        enviarEmailVerificacao: jest.fn((_email: string, link: string) => {
          linksVerificacao.push(link);
          return Promise.resolve();
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
  });

  afterAll(async () => {
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCriados } } });
    await prisma.restaurante.deleteMany({
      where: { id: { in: restaurantesCriados } },
    });
    await app.close();
  });

  async function registrar(sufixo: string, documento = gerarCpfValido()) {
    const email = `antiabuso-${sufixo}-${execucao}@teste.comandai.dev`;
    const resposta = await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja Antiabuso ${sufixo} ${execucao}`,
        nomeDono: `Dono ${sufixo}`,
        email,
        senha: 'senha-teste-123',
        documento,
      })
      .expect(201);
    const corpo = resposta.body as RespostaAuth;
    usuariosCriados.push(corpo.usuario.id);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: corpo.usuario.id },
    });
    restaurantesCriados.push(usuario.restauranteId);
    return {
      email,
      token: corpo.accessToken,
      restauranteId: usuario.restauranteId,
    };
  }

  it('rejeita CPF com dígito verificador inválido', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja CPF Invalido ${execucao}`,
        nomeDono: 'Dono',
        email: `antiabuso-cpf-invalido-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: '111.111.111-11',
      })
      .expect(400);
  });

  it('rejeita segundo restaurante com o mesmo CPF (com ou sem máscara)', async () => {
    const cpf = gerarCpfValido();
    await registrar('cpf-original', cpf);

    const mascarado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja CPF Repetido ${execucao}`,
        nomeDono: 'Dono',
        email: `antiabuso-cpf-repetido-${execucao}@teste.comandai.dev`,
        senha: 'senha-teste-123',
        documento: mascarado,
      })
      .expect(409);
  });

  it('normaliza o e-mail: maiúsculas não criam conta duplicada', async () => {
    const { email } = await registrar('email-normalizado');
    await request(app.getHttpServer())
      .post('/api/auth/registrar')
      .send({
        nomeRestaurante: `Loja Email Maiusculo ${execucao}`,
        nomeDono: 'Dono',
        email: `  ${email.toUpperCase()} `,
        senha: 'senha-teste-123',
        documento: gerarCpfValido(),
      })
      .expect(409);
  });

  it('bloqueia escrita até o e-mail ser verificado, e o link de verificação libera', async () => {
    const { token } = await registrar('verificacao');

    const bloqueado = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Bebidas' })
      .expect(403);
    expect((bloqueado.body as { codigo: string }).codigo).toBe(
      'EMAIL_NAO_VERIFICADO',
    );

    const link = linksVerificacao[linksVerificacao.length - 1];
    const tokenVerificacao = new URL(link).searchParams.get('token');
    await request(app.getHttpServer())
      .post('/api/auth/verificar-email')
      .send({ token: tokenVerificacao })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Bebidas' })
      .expect(201);

    // Token é de uso único.
    await request(app.getHttpServer())
      .post('/api/auth/verificar-email')
      .send({ token: tokenVerificacao })
      .expect(401);
  });

  it('cadastro via Google exige CPF/CNPJ no onboarding antes de liberar escrita', async () => {
    const email = `antiabuso-google-${execucao}@teste.comandai.dev`;
    const resultado = await authService.loginOuRegistrarComGoogle({
      googleId: `google-antiabuso-${execucao}`,
      email,
      nome: 'Dono Google',
    });
    assertTokensCompletos(resultado);
    usuariosCriados.push(resultado.usuario.id);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: resultado.usuario.id },
    });
    restaurantesCriados.push(usuario.restauranteId);
    const token = resultado.accessToken;

    const bloqueado = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Lanches' })
      .expect(403);
    expect((bloqueado.body as { codigo: string }).codigo).toBe(
      'DOCUMENTO_PENDENTE',
    );

    const me = await request(app.getHttpServer())
      .patch('/api/restaurantes/me/documento')
      .set('Authorization', `Bearer ${token}`)
      .send({
        documento: gerarCpfValido(),
        nomeRestaurante: `Loja Google Onboarding ${execucao}`,
      })
      .expect(200);
    expect((me.body as { documentoPendente: boolean }).documentoPendente).toBe(
      false,
    );

    await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Lanches' })
      .expect(201);

    // Documento não pode ser trocado depois de informado.
    await request(app.getHttpServer())
      .patch('/api/restaurantes/me/documento')
      .set('Authorization', `Bearer ${token}`)
      .send({ documento: gerarCpfValido(), nomeRestaurante: 'Outro Nome' })
      .expect(409);
  });

  describe('admin da plataforma', () => {
    let tokenAdmin: string;
    let alvo: Awaited<ReturnType<typeof registrar>>;

    beforeAll(async () => {
      const admin = await registrar('admin');
      await marcarEmailVerificado(prisma, admin.email);
      await prisma.usuario.update({
        where: { email: admin.email },
        data: { superAdmin: true },
      });
      tokenAdmin = admin.token;

      alvo = await registrar('alvo');
      await marcarEmailVerificado(prisma, alvo.email);
    });

    it('usuário comum não acessa as rotas de admin', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/restaurantes')
        .set('Authorization', `Bearer ${alvo.token}`)
        .expect(403);
    });

    it('admin encontra restaurante pelo e-mail do dono', async () => {
      const resposta = await request(app.getHttpServer())
        .get('/api/admin/restaurantes')
        .query({ busca: alvo.email })
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      const corpo = resposta.body as {
        itens: { id: string; documento: string }[];
      };
      expect(corpo.itens.map((i) => i.id)).toContain(alvo.restauranteId);
      expect(corpo.itens[0].documento).toContain('*');
    });

    it('suspender bloqueia o painel e tira a loja do ar; reativar devolve', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/restaurantes/${alvo.restauranteId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ suspenso: true })
        .expect(200);

      const bloqueado = await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${alvo.token}`)
        .send({ nome: 'Pizzas' })
        .expect(403);
      expect((bloqueado.body as { codigo: string }).codigo).toBe(
        'CONTA_SUSPENSA',
      );

      const { slug } = await prisma.restaurante.findUniqueOrThrow({
        where: { id: alvo.restauranteId },
      });
      await request(app.getHttpServer()).get(`/api/loja/${slug}`).expect(404);

      await request(app.getHttpServer())
        .patch(`/api/admin/restaurantes/${alvo.restauranteId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ suspenso: false })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/categorias')
        .set('Authorization', `Bearer ${alvo.token}`)
        .send({ nome: 'Pizzas' })
        .expect(201);
    });

    it('estender trial vencido conta a partir de agora', async () => {
      await prisma.restaurante.update({
        where: { id: alvo.restauranteId },
        data: { trialEndsAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
      });

      await request(app.getHttpServer())
        .patch(`/api/admin/restaurantes/${alvo.restauranteId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ estenderTrialDias: 7 })
        .expect(200);

      const { trialEndsAt } = await prisma.restaurante.findUniqueOrThrow({
        where: { id: alvo.restauranteId },
      });
      const diasRestantes =
        (trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(diasRestantes).toBeGreaterThan(6.9);
      expect(diasRestantes).toBeLessThan(7.1);
    });
  });
});
