import 'dotenv/config';
import { randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/auth/auth.service';
import { JwtStrategy } from './../src/auth/jwt.strategy';
import { RefreshTokenService } from './../src/auth/refresh-token.service';
import { TwoFactorService } from './../src/auth/two-factor.service';
import { descriptografar } from './../src/common/crypto.util';
import { PrismaService } from './../src/prisma/prisma.service';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

/**
 * Testa TwoFactorService e a integração com AuthService.login()/
 * verificarDoisFatores() diretamente (sem passar pela cadeia HTTP), seguindo
 * o mesmo padrão dos outros specs de auth.
 */
describe('Autenticação de dois fatores (e2e)', () => {
  let app: INestApplication;
  let authService: AuthService;
  let twoFactorService: TwoFactorService;
  let refreshTokenService: RefreshTokenService;
  let jwtStrategy: JwtStrategy;
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
    twoFactorService = app.get(TwoFactorService);
    refreshTokenService = app.get(RefreshTokenService);
    jwtStrategy = app.get(JwtStrategy);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.codigoBackupDoisFatores.deleteMany({
      where: { usuarioId: { in: usuariosCriados } },
    });
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
    const email = `2fa-${sufixo}-${execucao}@teste.comandai.dev`;
    const resultado = await authService.registrar({
      nomeRestaurante: `Loja 2FA ${sufixo} ${execucao}`,
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
    return { email, usuarioId: resultado.usuario.id };
  }

  async function ativarDoisFatores(usuarioId: string) {
    await twoFactorService.gerarSetup(usuarioId);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
    });
    const secret = descriptografar(usuario.totpSecret!);
    const codigo = authenticator.generate(secret);
    const { backupCodes } = await twoFactorService.confirmarAtivacao(
      usuarioId,
      codigo,
    );
    return { secret, backupCodes };
  }

  it('setup + enable com código TOTP válido ativa o 2FA e retorna 10 códigos de backup', async () => {
    const { usuarioId } = await criarUsuario('setup');
    const { backupCodes } = await ativarDoisFatores(usuarioId);

    expect(backupCodes).toHaveLength(10);

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
    });
    expect(usuario.doisFatoresAtivo).toBe(true);
  });

  it('enable com código TOTP inválido é rejeitado e não ativa o 2FA', async () => {
    const { usuarioId } = await criarUsuario('setupinvalido');
    await twoFactorService.gerarSetup(usuarioId);

    await expect(
      twoFactorService.confirmarAtivacao(usuarioId, '000000'),
    ).rejects.toThrow(UnauthorizedException);

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
    });
    expect(usuario.doisFatoresAtivo).toBe(false);
  });

  it('login de usuário com 2FA ativo retorna requiresTwoFactor + tempToken, não tokens completos', async () => {
    const { email, usuarioId } = await criarUsuario('login2fa');
    await ativarDoisFatores(usuarioId);

    const resultado = await authService.login(email, 'senha-123456');

    expect(
      'requiresTwoFactor' in resultado && resultado.requiresTwoFactor,
    ).toBe(true);
    expect((resultado as { tempToken: string }).tempToken).toBeDefined();
    expect((resultado as { accessToken?: string }).accessToken).toBeUndefined();
  });

  it('verify com código TOTP válido emite tokens completos', async () => {
    const { email, usuarioId } = await criarUsuario('verifytotp');
    const { secret } = await ativarDoisFatores(usuarioId);

    const login = await authService.login(email, 'senha-123456');
    const tempToken = (login as { tempToken: string }).tempToken;

    const codigo = authenticator.generate(secret);
    const completo = await authService.verificarDoisFatores(tempToken, codigo);

    expect(completo.accessToken).toBeDefined();
    expect(completo.refreshToken).toBeDefined();
  });

  it('código de backup funciona uma única vez', async () => {
    const { email, usuarioId } = await criarUsuario('backup');
    const { backupCodes } = await ativarDoisFatores(usuarioId);
    const codigoBackup = backupCodes[0];

    const login = await authService.login(email, 'senha-123456');
    const tempToken1 = (login as { tempToken: string }).tempToken;

    const completo = await authService.verificarDoisFatores(
      tempToken1,
      codigoBackup,
    );
    expect(completo.accessToken).toBeDefined();

    const login2 = await authService.login(email, 'senha-123456');
    const tempToken2 = (login2 as { tempToken: string }).tempToken;

    await expect(
      authService.verificarDoisFatores(tempToken2, codigoBackup),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('tempToken expirado ou inválido é rejeitado', async () => {
    await expect(
      authService.verificarDoisFatores('token-invalido-qualquer', '123456'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('token de sessão parcial (tipo PARCIAL_2FA) é rejeitado pelo JwtStrategy em rotas normais', () => {
    expect(() =>
      jwtStrategy.validate({
        sub: 'usuario-fake',
        email: 'fake@teste.comandai.dev',
        restauranteId: 'restaurante-fake',
        cargo: 'DONO',
        tipo: 'PARCIAL_2FA',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('disable exige senha correta e revoga todos os refresh tokens do usuário', async () => {
    const { email, usuarioId } = await criarUsuario('disable');
    await ativarDoisFatores(usuarioId);

    await expect(
      twoFactorService.desativar(usuarioId, 'senha-errada'),
    ).rejects.toThrow(UnauthorizedException);

    const refreshAtivo = await refreshTokenService.emitir(usuarioId);
    await twoFactorService.desativar(usuarioId, 'senha-123456');

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
    });
    expect(usuario.doisFatoresAtivo).toBe(false);
    expect(usuario.totpSecret).toBeNull();

    await expect(authService.refresh(refreshAtivo)).rejects.toThrow(
      UnauthorizedException,
    );

    void email;
  });
});
