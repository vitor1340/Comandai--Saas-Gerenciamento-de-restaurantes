import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  HttpStatus,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/auth/auth.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { assertTokensCompletos } from './helpers/assert-tokens-completos';
import { gerarCpfValido, marcarEmailVerificado } from './helpers/cadastro';

/**
 * Testa AuthService.login() direto (sem HTTP), justamente pra não esbarrar
 * no rate limit por IP da rota (@Throttle 5/60s) — esse teste é sobre a
 * trava por e-mail (item 8 da auditoria), uma camada separada e
 * complementar ao throttle por IP.
 */
describe('Lockout de login por e-mail (e2e)', () => {
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
    await prisma.tentativaLoginFalha.deleteMany({});
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCriados } } });
    await prisma.restaurante.deleteMany({
      where: { id: { in: restaurantesCriados } },
    });
    await app.close();
  });

  async function criarUsuario(sufixo: string) {
    const email = `lockout-${sufixo}-${execucao}@teste.comandai.dev`;
    const resultado = await authService.registrar({
      nomeRestaurante: `Loja Lockout ${sufixo} ${execucao}`,
      nomeDono: `Dono ${sufixo}`,
      email,
      senha: 'senha-123456',
      documento: gerarCpfValido(),
    });
    await marcarEmailVerificado(prisma, email);
    assertTokensCompletos(resultado);
    usuariosCriados.push(resultado.usuario.id);
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: resultado.usuario.id },
    });
    restaurantesCriados.push(usuario.restauranteId);
    return { email };
  }

  it('após 10 tentativas com senha errada, a 11ª é bloqueada por lockout (429), mesmo com a senha certa', async () => {
    const { email } = await criarUsuario('bloqueio');

    for (let i = 0; i < 10; i++) {
      await expect(authService.login(email, 'senha-errada')).rejects.toThrow(
        UnauthorizedException,
      );
    }

    // A 11ª tentativa é bloqueada pelo lockout ANTES de checar a senha —
    // prova disso: mesmo usando a senha CORRETA, ainda assim é recusada.
    let erroCapturado: unknown;
    try {
      await authService.login(email, 'senha-123456');
    } catch (erro) {
      erroCapturado = erro;
    }

    expect(erroCapturado).toBeDefined();
    expect((erroCapturado as { status?: number }).status).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('lockout é por e-mail: falhas numa conta não bloqueiam outra', async () => {
    const { email: emailAtacado } = await criarUsuario('vitima');
    const { email: emailControle } = await criarUsuario('controle');

    for (let i = 0; i < 10; i++) {
      await expect(
        authService.login(emailAtacado, 'senha-errada'),
      ).rejects.toThrow(UnauthorizedException);
    }

    // A conta-controle, que nunca teve tentativa nenhuma, continua livre.
    await expect(
      authService.login(emailControle, 'senha-123456'),
    ).resolves.toBeDefined();
  });

  it('login com e-mail inexistente falha normalmente (não derruba, não trava com erro interno)', async () => {
    await expect(
      authService.login(
        `nao-existe-${execucao}@teste.comandai.dev`,
        'qualquer-coisa',
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});
