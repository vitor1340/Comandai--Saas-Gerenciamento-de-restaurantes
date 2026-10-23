import 'dotenv/config';
import { randomUUID } from 'crypto';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/auth/auth.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { assertTokensCompletos } from './helpers/assert-tokens-completos';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

/**
 * Testa AuthService.loginOuRegistrarComGoogle() e a troca de código
 * temporário diretamente (sem simular o handshake OAuth real do Google,
 * que não é viável em CI).
 */
describe('Login com Google (e2e)', () => {
  let app: INestApplication;
  let authService: AuthService;
  let prisma: PrismaService;

  const execucao = randomUUID().slice(0, 8);
  const restaurantesCriados: string[] = [];
  const usuariosCriados: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    authService = app.get(AuthService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCriados } } });
    await prisma.restaurante.deleteMany({
      where: { id: { in: restaurantesCriados } },
    });
    await app.close();
  });

  it('e-mail novo cria restaurante (plano FREE) + usuário DONO sem senha', async () => {
    const email = `google-novo-${execucao}@teste.comandai.dev`;
    const googleId = `google-id-novo-${execucao}`;

    const resultado = await authService.loginOuRegistrarComGoogle({
      googleId,
      email,
      nome: 'Cliente Google Teste',
    });
    assertTokensCompletos(resultado);
    usuariosCriados.push(resultado.usuario.id);

    expect(resultado.accessToken).toEqual(expect.any(String));
    expect(resultado.usuario.email).toBe(email);
    expect(resultado.usuario.cargo).toBe('DONO');

    const usuarioNoBanco = await prisma.usuario.findUniqueOrThrow({
      where: { id: resultado.usuario.id },
    });
    expect(usuarioNoBanco.googleId).toBe(googleId);
    expect(usuarioNoBanco.senhaHash).toBeNull();

    const restaurante = await prisma.restaurante.findUniqueOrThrow({
      where: { id: usuarioNoBanco.restauranteId },
    });
    restaurantesCriados.push(restaurante.id);
    expect(restaurante.plano).toBe('FREE');
  });

  it('e-mail já existente por senha vincula a conta ao Google (não cria restaurante novo)', async () => {
    const email = `google-vincula-${execucao}@teste.comandai.dev`;

    const registrado = await authService.registrar({
      nomeRestaurante: `Loja Vínculo Teste ${execucao}`,
      nomeDono: 'Dono Original',
      email,
      senha: 'senha-teste-123',
      documento: gerarCpfValido(),
    });
    await marcarEmailVerificado(prisma, email);
    usuariosCriados.push(registrado.usuario.id);
    const usuarioOriginal = await prisma.usuario.findUniqueOrThrow({
      where: { id: registrado.usuario.id },
    });
    restaurantesCriados.push(usuarioOriginal.restauranteId);

    const googleId = `google-id-vincula-${execucao}`;
    const resultado = await authService.loginOuRegistrarComGoogle({
      googleId,
      email,
      nome: 'Dono Original',
    });
    assertTokensCompletos(resultado);

    expect(resultado.usuario.id).toBe(registrado.usuario.id);

    const usuarioAtualizado = await prisma.usuario.findUniqueOrThrow({
      where: { id: registrado.usuario.id },
    });
    expect(usuarioAtualizado.googleId).toBe(googleId);
    expect(usuarioAtualizado.restauranteId).toBe(usuarioOriginal.restauranteId);

    const totalRestaurantes = await prisma.restaurante.count({
      where: { id: usuarioOriginal.restauranteId },
    });
    expect(totalRestaurantes).toBe(1);
  });

  it('e-mail cadastrado por senha SEM verificação: Google assume a conta, descarta a senha e revoga sessões', async () => {
    const email = `google-pre-hijack-${execucao}@teste.comandai.dev`;

    // Simula o atacante: cadastra o e-mail da vítima com senha própria e
    // nunca confirma o e-mail (não chama marcarEmailVerificado).
    const registrado = await authService.registrar({
      nomeRestaurante: `Loja Pre Hijack ${execucao}`,
      nomeDono: 'Atacante',
      email,
      senha: 'senha-do-atacante',
      documento: gerarCpfValido(),
    });
    assertTokensCompletos(registrado);
    usuariosCriados.push(registrado.usuario.id);
    const original = await prisma.usuario.findUniqueOrThrow({
      where: { id: registrado.usuario.id },
    });
    restaurantesCriados.push(original.restauranteId);
    expect(original.emailVerificadoEm).toBeNull();

    await authService.loginOuRegistrarComGoogle({
      googleId: `google-id-pre-hijack-${execucao}`,
      email,
      nome: 'Vítima',
    });

    const depois = await prisma.usuario.findUniqueOrThrow({
      where: { id: registrado.usuario.id },
    });
    expect(depois.senhaHash).toBeNull();
    expect(depois.emailVerificadoEm).not.toBeNull();

    // O refresh token que o atacante recebeu no cadastro foi revogado.
    await expect(
      authService.refresh(registrado.refreshToken),
    ).rejects.toThrow();
    await expect(
      authService.login(email, 'senha-do-atacante'),
    ).rejects.toThrow();
  });

  it('mesmo googleId chamado duas vezes não cria usuário novo', async () => {
    const email = `google-recorrente-${execucao}@teste.comandai.dev`;
    const googleId = `google-id-recorrente-${execucao}`;

    const primeira = await authService.loginOuRegistrarComGoogle({
      googleId,
      email,
      nome: 'Login Recorrente',
    });
    assertTokensCompletos(primeira);
    usuariosCriados.push(primeira.usuario.id);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: primeira.usuario.id },
    });
    restaurantesCriados.push(usuario.restauranteId);

    const segunda = await authService.loginOuRegistrarComGoogle({
      googleId,
      email,
      nome: 'Login Recorrente',
    });
    assertTokensCompletos(segunda);

    expect(segunda.usuario.id).toBe(primeira.usuario.id);
    const totalUsuarios = await prisma.usuario.count({ where: { googleId } });
    expect(totalUsuarios).toBe(1);
  });

  it('login por senha falha com mensagem específica para conta Google-only', async () => {
    const email = `google-somente-${execucao}@teste.comandai.dev`;
    const resultado = await authService.loginOuRegistrarComGoogle({
      googleId: `google-id-somente-${execucao}`,
      email,
      nome: 'Só Google',
    });
    assertTokensCompletos(resultado);
    usuariosCriados.push(resultado.usuario.id);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: resultado.usuario.id },
    });
    restaurantesCriados.push(usuario.restauranteId);

    await expect(authService.login(email, 'qualquer-senha')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('código de troca temporário funciona uma única vez', () => {
    const codigo = authService.criarCodigoTrocaTemporario(
      'token-fake',
      'refresh-fake',
      {
        id: 'usuario-fake',
        nome: 'Fake',
        email: 'fake@teste.comandai.dev',
        cargo: 'DONO',
      },
    );

    const trocado = authService.trocarCodigoTemporario(codigo);
    expect(trocado.accessToken).toBe('token-fake');
    expect(trocado.refreshToken).toBe('refresh-fake');

    expect(() => authService.trocarCodigoTemporario(codigo)).toThrow(
      UnauthorizedException,
    );
  });

  it('código de troca inexistente é rejeitado', () => {
    expect(() =>
      authService.trocarCodigoTemporario('codigo-que-nao-existe'),
    ).toThrow(UnauthorizedException);
  });
});
