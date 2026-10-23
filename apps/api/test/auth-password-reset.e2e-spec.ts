import 'dotenv/config';
import { randomUUID } from 'crypto';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/auth/auth.service';
import { EmailService } from './../src/auth/email.service';
import { hashToken } from './../src/common/token.util';
import { PrismaService } from './../src/prisma/prisma.service';
import { assertTokensCompletos } from './helpers/assert-tokens-completos';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

/**
 * Testa AuthService.criarTokenRedefinicao()/solicitarRedefinicaoSenha()/
 * redefinirSenha() diretamente (sem passar pela cadeia HTTP). O EmailService
 * é substituído por um mock — não faz sentido bater na API real do Resend em
 * CI, e o teste não tem como ler um e-mail de verdade de qualquer forma.
 */
describe('Recuperação de senha (e2e)', () => {
  let app: INestApplication;
  let authService: AuthService;
  let prisma: PrismaService;
  let emailServiceMock: {
    enviarEmailRedefinicaoSenha: jest.Mock;
    enviarEmailVerificacao: jest.Mock;
  };

  const execucao = randomUUID().slice(0, 8);
  const restaurantesCriados: string[] = [];
  const usuariosCriados: string[] = [];

  beforeAll(async () => {
    emailServiceMock = {
      enviarEmailRedefinicaoSenha: jest.fn().mockResolvedValue(undefined),
      enviarEmailVerificacao: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue(emailServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    authService = app.get(AuthService);
    prisma = app.get(PrismaService);
  });

  afterEach(() => {
    emailServiceMock.enviarEmailRedefinicaoSenha.mockClear();
  });

  afterAll(async () => {
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCriados } } });
    await prisma.restaurante.deleteMany({
      where: { id: { in: restaurantesCriados } },
    });
    await app.close();
  });

  async function criarUsuarioComSenha(sufixo: string) {
    const email = `reset-${sufixo}-${execucao}@teste.comandai.dev`;
    const resultado = await authService.registrar({
      nomeRestaurante: `Loja Reset ${sufixo} ${execucao}`,
      nomeDono: `Dono ${sufixo}`,
      email,
      senha: 'senha-antiga-123',
      documento: gerarCpfValido(),
    });
    await marcarEmailVerificado(prisma, email);
    usuariosCriados.push(resultado.usuario.id);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: resultado.usuario.id },
    });
    restaurantesCriados.push(usuario.restauranteId);
    return { id: resultado.usuario.id, email };
  }

  it('token válido redefine a senha; a senha antiga para de funcionar', async () => {
    const usuario = await criarUsuarioComSenha('valido');
    const token = await authService.criarTokenRedefinicao(usuario.id);

    await authService.redefinirSenha(token, 'senha-nova-456');

    await expect(
      authService.login(usuario.email, 'senha-nova-456'),
    ).resolves.toBeDefined();
    await expect(
      authService.login(usuario.email, 'senha-antiga-123'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('reusar o mesmo token depois de usado falha (uso único)', async () => {
    const usuario = await criarUsuarioComSenha('reuso');
    const token = await authService.criarTokenRedefinicao(usuario.id);

    await authService.redefinirSenha(token, 'senha-nova-456');

    await expect(
      authService.redefinirSenha(token, 'outra-senha-789'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('token expirado é rejeitado', async () => {
    const usuario = await criarUsuarioComSenha('expirado');
    const tokenBruto = `token-expirado-${randomUUID()}`;
    await prisma.tokenRedefinicaoSenha.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: hashToken(tokenBruto),
        expiraEm: new Date(Date.now() - 1000),
      },
    });

    await expect(
      authService.redefinirSenha(tokenBruto, 'senha-nova-456'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('token inexistente é rejeitado', async () => {
    await expect(
      authService.redefinirSenha('token-que-nunca-existiu', 'senha-nova-456'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('solicitar redefinição para e-mail inexistente não lança erro e não cria token nem envia e-mail', async () => {
    await expect(
      authService.solicitarRedefinicaoSenha(
        `nao-existe-${execucao}@teste.comandai.dev`,
        '127.0.0.1',
      ),
    ).resolves.toBeUndefined();
    expect(emailServiceMock.enviarEmailRedefinicaoSenha).not.toHaveBeenCalled();
  });

  it('solicitar redefinição para e-mail existente cria exatamente um token e envia o e-mail', async () => {
    const usuario = await criarUsuarioComSenha('solicita');

    await authService.solicitarRedefinicaoSenha(usuario.email, '127.0.0.1');

    const total = await prisma.tokenRedefinicaoSenha.count({
      where: { usuarioId: usuario.id },
    });
    expect(total).toBe(1);
    expect(emailServiceMock.enviarEmailRedefinicaoSenha).toHaveBeenCalledTimes(
      1,
    );
    const [destinatario, link] = emailServiceMock.enviarEmailRedefinicaoSenha
      .mock.calls[0] as [string, string];
    expect(destinatario).toBe(usuario.email);
    expect(link).toContain('/redefinir-senha?token=');
  });

  it('conta Google-only (sem senha) consegue definir uma senha pela primeira vez', async () => {
    const email = `reset-google-${execucao}@teste.comandai.dev`;
    const resultado = await authService.loginOuRegistrarComGoogle({
      googleId: `google-id-reset-${execucao}`,
      email,
      nome: 'Conta Google',
    });
    assertTokensCompletos(resultado);
    usuariosCriados.push(resultado.usuario.id);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: resultado.usuario.id },
    });
    restaurantesCriados.push(usuario.restauranteId);
    expect(usuario.senhaHash).toBeNull();

    const token = await authService.criarTokenRedefinicao(usuario.id);
    await authService.redefinirSenha(token, 'primeira-senha-123');

    await expect(
      authService.login(email, 'primeira-senha-123'),
    ).resolves.toBeDefined();
  });
});
