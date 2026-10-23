import 'dotenv/config';
import { randomUUID } from 'crypto';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/auth/auth.service';
import { RefreshTokenService } from './../src/auth/refresh-token.service';
import { hashToken } from './../src/common/token.util';
import { PrismaService } from './../src/prisma/prisma.service';
import { assertTokensCompletos } from './helpers/assert-tokens-completos';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

/**
 * Testa AuthService.refresh()/logout()/logoutTodasSessoes() e
 * RefreshTokenService diretamente (sem passar pela cadeia HTTP), seguindo o
 * mesmo padrão dos outros specs de auth.
 */
describe('Refresh token e revogação de sessão (e2e)', () => {
  let app: INestApplication;
  let authService: AuthService;
  let refreshTokenService: RefreshTokenService;
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
    refreshTokenService = app.get(RefreshTokenService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({
      where: { usuarioId: { in: usuariosCriados } },
    });
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCriados } } });
    await prisma.restaurante.deleteMany({
      where: { id: { in: restaurantesCriados } },
    });
    await app.close();
  });

  async function criarUsuario(sufixo: string) {
    const email = `refresh-${sufixo}-${execucao}@teste.comandai.dev`;
    const resultado = await authService.registrar({
      nomeRestaurante: `Loja Refresh ${sufixo} ${execucao}`,
      nomeDono: `Dono ${sufixo}`,
      email,
      senha: 'senha-123456',
      documento: gerarCpfValido(),
    });
    await marcarEmailVerificado(prisma, email);
    usuariosCriados.push(resultado.usuario.id);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: resultado.usuario.id },
    });
    restaurantesCriados.push(usuario.restauranteId);
    return resultado;
  }

  it('registrar já emite um refresh token válido junto do access token', async () => {
    const resultado = await criarUsuario('registro');
    expect(resultado.refreshToken).toBeDefined();
    expect(resultado.accessToken).toBeDefined();
  });

  it('refresh válido rotaciona: emite um novo par e invalida o token antigo', async () => {
    const resultado = await criarUsuario('rotacao');
    const primeiroRefresh = resultado.refreshToken;

    const renovado = await authService.refresh(primeiroRefresh);
    expect(renovado.accessToken).toBeDefined();
    expect(renovado.refreshToken).not.toBe(primeiroRefresh);

    await expect(authService.refresh(primeiroRefresh)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('reusar um refresh token já rotacionado revoga todas as sessões do usuário', async () => {
    const resultado = await criarUsuario('reuso');
    const usuarioId = (
      await prisma.usuario.findUniqueOrThrow({
        where: { email: `refresh-reuso-${execucao}@teste.comandai.dev` },
      })
    ).id;

    const segundoLogin = await authService.login(
      `refresh-reuso-${execucao}@teste.comandai.dev`,
      'senha-123456',
    );
    assertTokensCompletos(segundoLogin);

    const renovado = await authService.refresh(resultado.refreshToken);
    expect(renovado.refreshToken).toBeDefined();

    // Reusar o token antigo (já rotacionado) deve derrubar TODAS as sessões,
    // inclusive o token do segundo login que nunca foi usado.
    await expect(authService.refresh(resultado.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );

    await expect(
      authService.refresh(segundoLogin.refreshToken),
    ).rejects.toThrow(UnauthorizedException);

    await expect(authService.refresh(renovado.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );

    void usuarioId;
  });

  it('duas rotações concorrentes com o mesmo token: só uma vence, a outra é tratada como reuso', async () => {
    const resultado = await criarUsuario('concorrencia');
    const tokenOriginal = resultado.refreshToken;

    // Dispara as duas ao mesmo tempo, com o MESMO token — antes da correção
    // do item 6, o `update` por `id` (sem condição no WHERE) deixava as duas
    // passarem da checagem de "já revogado" e gerarem sucessores válidos.
    const [primeira, segunda] = await Promise.allSettled([
      refreshTokenService.rotacionar(tokenOriginal),
      refreshTokenService.rotacionar(tokenOriginal),
    ]);

    const sucessos = [primeira, segunda].filter(
      (
        r,
      ): r is PromiseFulfilledResult<{
        usuarioId: string;
        refreshToken: string;
      }> => r.status === 'fulfilled',
    );
    const falhas = [primeira, segunda].filter((r) => r.status === 'rejected');

    expect(sucessos).toHaveLength(1);
    expect(falhas).toHaveLength(1);

    // A tentativa perdedora foi tratada como reuso — revoga TODAS as
    // sessões do usuário, inclusive a que "venceu" a corrida.
    const tokenVencedor = sucessos[0].value.refreshToken;
    await expect(refreshTokenService.rotacionar(tokenVencedor)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refresh token expirado é rejeitado', async () => {
    const resultado = await criarUsuario('expirado');
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email: `refresh-expirado-${execucao}@teste.comandai.dev` },
    });

    const tokenBruto = `refresh-expirado-${randomUUID()}`;
    await prisma.refreshToken.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: hashToken(tokenBruto),
        expiraEm: new Date(Date.now() - 1000),
      },
    });

    await expect(authService.refresh(tokenBruto)).rejects.toThrow(
      UnauthorizedException,
    );

    void resultado;
  });

  it('refresh token inexistente é rejeitado', async () => {
    await expect(
      authService.refresh(`token-que-nunca-existiu-${randomUUID()}`),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('logout revoga o refresh token; refresh subsequente falha', async () => {
    const resultado = await criarUsuario('logout');

    await authService.logout(resultado.refreshToken);

    await expect(authService.refresh(resultado.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('logoutTodasSessoes revoga todos os refresh tokens do usuário', async () => {
    const email = `refresh-logoutall-${execucao}@teste.comandai.dev`;
    const primeiro = await criarUsuario('logoutall');
    const segundo = await authService.login(email, 'senha-123456');
    assertTokensCompletos(segundo);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email },
    });

    await authService.logoutTodasSessoes(usuario.id);

    await expect(authService.refresh(primeiro.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(authService.refresh(segundo.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('redefinir a senha revoga todas as sessões existentes', async () => {
    const email = `refresh-resetsenha-${execucao}@teste.comandai.dev`;
    const resultado = await criarUsuario('resetsenha');
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email },
    });

    const tokenRedefinicao = await authService.criarTokenRedefinicao(
      usuario.id,
    );
    await authService.redefinirSenha(tokenRedefinicao, 'senha-nova-789');

    await expect(authService.refresh(resultado.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('job de limpeza remove refresh tokens expirados e revogados antigos', async () => {
    const resultado = await criarUsuario('limpeza');
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email: `refresh-limpeza-${execucao}@teste.comandai.dev` },
    });

    const tokenAntigoExpirado = `limpeza-expirado-${randomUUID()}`;
    await prisma.refreshToken.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: hashToken(tokenAntigoExpirado),
        expiraEm: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      },
    });

    await refreshTokenService.limparTokensAntigos();

    const restante = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(tokenAntigoExpirado) },
    });
    expect(restante).toBeNull();

    // O token válido criado no registro (não expirado, não antigo) sobrevive.
    const aindaExiste = await prisma.refreshToken.findMany({
      where: { usuarioId: usuario.id },
    });
    expect(aindaExiste.length).toBeGreaterThan(0);

    void resultado;
  });
});
