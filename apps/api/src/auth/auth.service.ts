import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import {
  CargoUsuario,
  PlanoRestaurante,
  Prisma,
} from '../../generated/prisma/client';
import { normalizarDocumento } from '../common/documento.util';
import { exigirVariavelAmbiente } from '../common/env.util';
import { gerarSlugUnico } from '../common/slugify.util';
import { gerarTokenAleatorio, hashToken } from '../common/token.util';
import { PrismaService } from '../prisma/prisma.service';
import { RegistrarDto } from './dto/registrar.dto';
import { EmailService } from './email.service';
import { UsuarioGoogle } from './google.types';
import { JwtPayload, JwtPayloadParcial2fa } from './jwt.types';
import { RefreshTokenMeta, RefreshTokenService } from './refresh-token.service';
import { TurnstileService } from './turnstile.service';
import { TwoFactorService } from './two-factor.service';

const TTL_TOKEN_PARCIAL_2FA = '5m';

// Hash bcrypt de um valor fixo qualquer — nunca corresponde a senha
// nenhuma. Usado só pra `bcrypt.compare` sempre rodar o mesmo trabalho
// computacional, mesmo quando o e-mail não existe (ver login() — evita que
// a diferença de tempo de resposta revele quais e-mails têm conta).
const HASH_DUMMY_TEMPO_CONSTANTE =
  '$2b$10$4cBsK3eeqcZ2sYeBHxyUKeLlj2ApwxgbZlNu6oMXMrATDOYkpMCdO';

const DIAS_TESTE_GRATIS = 7;
const JANELA_LOCKOUT_LOGIN_MS = 15 * 60_000;
const LIMITE_TENTATIVAS_FALHAS_POR_EMAIL = 10;
const DIAS_RETENCAO_TENTATIVAS_LOGIN = 1;

export interface UsuarioResumo {
  id: string;
  nome: string;
  email: string;
  cargo: CargoUsuario;
}

interface CodigoTrocaGoogle {
  accessToken: string;
  refreshToken: string;
  usuario: UsuarioResumo;
  expiraEm: number;
}

const TTL_CODIGO_TROCA_MS = 60_000;
const TTL_TOKEN_REDEFINICAO_MS = 30 * 60_000;
const TTL_TOKEN_VERIFICACAO_EMAIL_MS = 24 * 60 * 60_000;

// Genérica de propósito: não confirma de quem é o documento.
const MENSAGEM_DOCUMENTO_EM_USO =
  'Já existe um restaurante cadastrado com este CPF/CNPJ. Se ele é seu, entre com a conta original.';

/**
 * Campos envolvidos numa violação de unicidade (P2002) do Prisma, ou null
 * se o erro for outro. O formato de `meta` muda entre engines/adapters
 * (`target` no engine nativo, `driverAdapterError` com o adapter pg), então
 * procura o nome do campo no meta serializado em vez de depender da forma.
 */
function camposViolacaoUnica(erro: unknown): string | null {
  if (
    erro instanceof Prisma.PrismaClientKnownRequestError &&
    erro.code === 'P2002'
  ) {
    return JSON.stringify(erro.meta ?? {});
  }
  return null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly codigosTrocaGoogle = new Map<string, CodigoTrocaGoogle>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly twoFactorService: TwoFactorService,
    private readonly turnstileService: TurnstileService,
  ) {}

  private async emitirTokenParcial2fa(usuarioId: string): Promise<string> {
    const payload: JwtPayloadParcial2fa = {
      sub: usuarioId,
      tipo: 'PARCIAL_2FA',
    };
    return this.jwtService.signAsync(payload, {
      expiresIn: TTL_TOKEN_PARCIAL_2FA,
    });
  }

  private async emitirTokens(
    usuario: {
      id: string;
      nome: string;
      email: string;
      cargo: CargoUsuario;
      restauranteId: string;
    },
    meta?: RefreshTokenMeta,
  ) {
    const payload: JwtPayload = {
      sub: usuario.id,
      email: usuario.email,
      restauranteId: usuario.restauranteId,
      cargo: usuario.cargo,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.refreshTokenService.emitir(usuario.id, meta),
    ]);

    return {
      accessToken,
      refreshToken,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        cargo: usuario.cargo,
      },
    };
  }

  async login(
    email: string,
    senha: string,
    meta?: RefreshTokenMeta,
    turnstileToken?: string,
  ) {
    await this.turnstileService.verificar(
      turnstileToken,
      meta?.ip ?? 'desconhecido',
    );
    await this.verificarLockoutPorEmail(email);

    const usuario = await this.prisma.usuario.findUnique({ where: { email } });

    // Roda o bcrypt.compare SEMPRE, mesmo quando o e-mail não existe (contra
    // um hash dummy fixo) — senão o tempo de resposta denunciaria quais
    // e-mails têm conta (bcrypt.compare custa ~100ms; um retorno imediato
    // sem rodá-lo é visivelmente mais rápido e vira um oráculo de timing).
    const senhaValida = await bcrypt.compare(
      senha,
      usuario?.senhaHash ?? HASH_DUMMY_TEMPO_CONSTANTE,
    );

    if (!usuario || !usuario.senhaHash || !senhaValida) {
      await this.registrarTentativaFalha(email);

      if (usuario && !usuario.senhaHash) {
        throw new UnauthorizedException(
          'Esta conta usa login com Google. Use o botão "Continuar com Google".',
        );
      }
      throw new UnauthorizedException('Credenciais inválidas');
    }

    if (usuario.doisFatoresAtivo) {
      return {
        requiresTwoFactor: true as const,
        tempToken: await this.emitirTokenParcial2fa(usuario.id),
      };
    }

    return this.emitirTokens(usuario, meta);
  }

  /**
   * Complementa o rate limit por IP (que já existe via @Throttle na rota):
   * um atacante distribuído (credential stuffing via botnet/proxies) faz
   * poucas tentativas por IP, mas ainda concentra muitas tentativas na
   * mesma CONTA — essa trava pega esse caso.
   */
  private async verificarLockoutPorEmail(email: string): Promise<void> {
    const desde = new Date(Date.now() - JANELA_LOCKOUT_LOGIN_MS);
    const tentativas = await this.prisma.tentativaLoginFalha.count({
      where: { email, criadoEm: { gte: desde } },
    });

    if (tentativas >= LIMITE_TENTATIVAS_FALHAS_POR_EMAIL) {
      throw new HttpException(
        'Muitas tentativas de login para esta conta. Tente novamente em alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async registrarTentativaFalha(email: string): Promise<void> {
    await this.prisma.tentativaLoginFalha.create({ data: { email } });
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async limparTentativasLoginAntigas(): Promise<void> {
    try {
      const limite = new Date(
        Date.now() - DIAS_RETENCAO_TENTATIVAS_LOGIN * 24 * 60 * 60 * 1000,
      );
      await this.prisma.tentativaLoginFalha.deleteMany({
        where: { criadoEm: { lt: limite } },
      });
    } catch (erro) {
      this.logger.error('Falha ao limpar tentativas de login antigas', erro);
    }
  }

  async verificarDoisFatores(
    tempToken: string,
    codigo: string,
    meta?: RefreshTokenMeta,
  ) {
    let payload: JwtPayloadParcial2fa;
    try {
      payload =
        await this.jwtService.verifyAsync<JwtPayloadParcial2fa>(tempToken);
    } catch {
      throw new UnauthorizedException('Sessão de verificação expirada');
    }

    if (payload.tipo !== 'PARCIAL_2FA') {
      throw new UnauthorizedException('Token inválido para esta operação');
    }

    await this.twoFactorService.verificarCodigo(payload.sub, codigo);

    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: payload.sub },
    });

    return this.emitirTokens(usuario, meta);
  }

  async registrar(dto: RegistrarDto, meta?: RefreshTokenMeta) {
    await this.turnstileService.verificar(
      dto.turnstileToken,
      meta?.ip ?? 'desconhecido',
    );

    const emailEmUso = await this.prisma.usuario.findUnique({
      where: { email: dto.email },
    });
    if (emailEmUso) {
      throw new ConflictException('Já existe uma conta com este e-mail');
    }

    const documento = normalizarDocumento(dto.documento);
    const documentoEmUso = await this.prisma.restaurante.findUnique({
      where: { documento },
      select: { id: true },
    });
    if (documentoEmUso) {
      throw new ConflictException(MENSAGEM_DOCUMENTO_EM_USO);
    }

    const senhaHash = await bcrypt.hash(dto.senha, 10);

    const usuario = await this.criarRestauranteComDono({
      nomeRestaurante: dto.nomeRestaurante,
      documento,
      ipCadastro: meta?.ip ?? null,
      dono: {
        nome: dto.nomeDono,
        email: dto.email,
        senhaHash,
      },
    });

    await this.enviarEmailVerificacao(usuario.id, usuario.email);

    return this.emitirTokens(usuario, meta);
  }

  /**
   * Cria restaurante + dono numa transação. A checagem de slug/documento
   * antes do insert não é atômica — dois cadastros simultâneos podem passar
   * por ela juntos — então a violação de unicidade (P2002) é tratada aqui:
   * slug repetido tenta de novo com outro slug, documento repetido vira 409.
   */
  private async criarRestauranteComDono(dados: {
    nomeRestaurante: string;
    documento: string | null;
    ipCadastro: string | null;
    dono: {
      nome: string;
      email: string;
      senhaHash?: string;
      googleId?: string;
      emailVerificadoEm?: Date;
    };
  }) {
    for (let tentativa = 0; ; tentativa++) {
      const slug = await gerarSlugUnico(
        dados.nomeRestaurante,
        async (candidato) => {
          const existente = await this.prisma.restaurante.findUnique({
            where: { slug: candidato },
          });
          return existente !== null;
        },
      );

      try {
        return await this.prisma.$transaction(async (tx) => {
          const restaurante = await tx.restaurante.create({
            data: {
              nome: dados.nomeRestaurante,
              slug,
              documento: dados.documento,
              ipCadastro: dados.ipCadastro,
              plano: PlanoRestaurante.FREE,
              trialEndsAt: new Date(
                Date.now() + DIAS_TESTE_GRATIS * 24 * 60 * 60 * 1000,
              ),
            },
          });

          return tx.usuario.create({
            data: {
              ...dados.dono,
              cargo: CargoUsuario.DONO,
              restauranteId: restaurante.id,
            },
          });
        });
      } catch (erro) {
        const campos = camposViolacaoUnica(erro);
        if (campos?.includes('documento')) {
          throw new ConflictException(MENSAGEM_DOCUMENTO_EM_USO);
        }
        if (campos?.includes('email')) {
          throw new ConflictException('Já existe uma conta com este e-mail');
        }
        if (campos?.includes('slug') && tentativa < 3) {
          continue;
        }
        throw erro;
      }
    }
  }

  async loginOuRegistrarComGoogle(
    dados: UsuarioGoogle,
    meta?: RefreshTokenMeta,
  ) {
    let usuario = await this.prisma.usuario.findUnique({
      where: { googleId: dados.googleId },
    });

    if (!usuario) {
      const porEmail = await this.prisma.usuario.findUnique({
        where: { email: dados.email },
      });
      if (porEmail && porEmail.emailVerificadoEm) {
        usuario = await this.prisma.usuario.update({
          where: { id: porEmail.id },
          data: { googleId: dados.googleId },
        });
      } else if (porEmail) {
        // Conta com senha cujo e-mail nunca foi confirmado: quem a criou
        // pode não ser o dono do e-mail (alguém cadastrou o e-mail da
        // vítima antes dela). O Google prova a posse do e-mail, então a
        // conta passa pro dono legítimo — a senha definida por quem
        // cadastrou é descartada e todas as sessões abertas são revogadas.
        usuario = await this.prisma.usuario.update({
          where: { id: porEmail.id },
          data: {
            googleId: dados.googleId,
            senhaHash: null,
            emailVerificadoEm: new Date(),
            doisFatoresAtivo: false,
            totpSecret: null,
          },
        });
        await this.prisma.codigoBackupDoisFatores.deleteMany({
          where: { usuarioId: usuario.id },
        });
        await this.refreshTokenService.revogarTodosDoUsuario(usuario.id);
      }
    }

    if (!usuario) {
      // Sem documento: o ContaLiberadaGuard bloqueia escrita até o dono
      // completar o onboarding (PATCH /restaurantes/me/documento).
      usuario = await this.criarRestauranteComDono({
        nomeRestaurante: `Restaurante de ${dados.nome}`.slice(0, 80),
        documento: null,
        ipCadastro: meta?.ip ?? null,
        dono: {
          nome: dados.nome.slice(0, 100),
          email: dados.email,
          googleId: dados.googleId,
          emailVerificadoEm: new Date(),
        },
      });
    }

    if (usuario.doisFatoresAtivo) {
      return {
        requiresTwoFactor: true as const,
        tempToken: await this.emitirTokenParcial2fa(usuario.id),
      };
    }

    return this.emitirTokens(usuario, meta);
  }

  criarCodigoTrocaTemporario(
    accessToken: string,
    refreshToken: string,
    usuario: UsuarioResumo,
  ): string {
    const codigo = randomUUID();
    this.codigosTrocaGoogle.set(codigo, {
      accessToken,
      refreshToken,
      usuario,
      expiraEm: Date.now() + TTL_CODIGO_TROCA_MS,
    });
    return codigo;
  }

  trocarCodigoTemporario(codigo: string) {
    const registro = this.codigosTrocaGoogle.get(codigo);
    this.codigosTrocaGoogle.delete(codigo);

    if (!registro || registro.expiraEm < Date.now()) {
      throw new UnauthorizedException('Código de login inválido ou expirado');
    }

    return {
      accessToken: registro.accessToken,
      refreshToken: registro.refreshToken,
      usuario: registro.usuario,
    };
  }

  async refresh(refreshTokenBruto: string, meta?: RefreshTokenMeta) {
    const { usuarioId, refreshToken } =
      await this.refreshTokenService.rotacionar(refreshTokenBruto, meta);

    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
    });

    const payload: JwtPayload = {
      sub: usuario.id,
      email: usuario.email,
      restauranteId: usuario.restauranteId,
      cargo: usuario.cargo,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      refreshToken,
    };
  }

  async logout(refreshTokenBruto: string): Promise<void> {
    await this.refreshTokenService.revogar(refreshTokenBruto);
  }

  async logoutTodasSessoes(usuarioId: string): Promise<void> {
    await this.refreshTokenService.revogarTodosDoUsuario(usuarioId);
  }

  async criarTokenRedefinicao(usuarioId: string): Promise<string> {
    await this.prisma.tokenRedefinicaoSenha.deleteMany({
      where: { usuarioId },
    });

    const token = gerarTokenAleatorio();
    await this.prisma.tokenRedefinicaoSenha.create({
      data: {
        usuarioId,
        tokenHash: hashToken(token),
        expiraEm: new Date(Date.now() + TTL_TOKEN_REDEFINICAO_MS),
      },
    });

    return token;
  }

  async enviarEmailVerificacao(
    usuarioId: string,
    email: string,
  ): Promise<void> {
    await this.prisma.tokenVerificacaoEmail.deleteMany({
      where: { usuarioId },
    });

    const token = gerarTokenAleatorio();
    await this.prisma.tokenVerificacaoEmail.create({
      data: {
        usuarioId,
        tokenHash: hashToken(token),
        expiraEm: new Date(Date.now() + TTL_TOKEN_VERIFICACAO_EMAIL_MS),
      },
    });

    const origemFrontend = exigirVariavelAmbiente('CORS_ORIGIN');
    const link = `${origemFrontend}/verificar-email?token=${token}`;

    // Falha no envio não derruba o cadastro — o dono pode pedir reenvio
    // pelo banner do painel.
    try {
      await this.emailService.enviarEmailVerificacao(email, link);
    } catch (erro) {
      this.logger.error(
        `Falha ao enviar e-mail de verificação para ${email}`,
        erro instanceof Error ? erro.stack : erro,
      );
    }
  }

  async reenviarEmailVerificacao(usuarioId: string): Promise<void> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
    });
    if (usuario.emailVerificadoEm) {
      return;
    }
    await this.enviarEmailVerificacao(usuario.id, usuario.email);
  }

  async verificarEmail(token: string): Promise<void> {
    const registro = await this.prisma.tokenVerificacaoEmail.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!registro || registro.expiraEm < new Date()) {
      throw new UnauthorizedException(
        'Link de verificação inválido ou expirado. Peça um novo pelo painel.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.usuario.update({
        where: { id: registro.usuarioId },
        data: { emailVerificadoEm: new Date() },
      }),
      this.prisma.tokenVerificacaoEmail.deleteMany({
        where: { usuarioId: registro.usuarioId },
      }),
    ]);
  }

  async solicitarRedefinicaoSenha(
    email: string,
    ip: string,
    turnstileToken?: string,
  ): Promise<void> {
    await this.turnstileService.verificar(turnstileToken, ip);
    const usuario = await this.prisma.usuario.findUnique({ where: { email } });
    if (!usuario) {
      return;
    }

    const token = await this.criarTokenRedefinicao(usuario.id);
    const origemFrontend = exigirVariavelAmbiente('CORS_ORIGIN');
    const link = `${origemFrontend}/redefinir-senha?token=${token}`;

    try {
      await this.emailService.enviarEmailRedefinicaoSenha(usuario.email, link);
    } catch (erro) {
      this.logger.error(
        `Falha ao enviar e-mail de redefinição para ${usuario.email}`,
        erro instanceof Error ? erro.stack : erro,
      );
    }
  }

  async redefinirSenha(token: string, novaSenha: string): Promise<void> {
    const registro = await this.prisma.tokenRedefinicaoSenha.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!registro || registro.expiraEm < new Date()) {
      throw new UnauthorizedException(
        'Token de redefinição inválido ou expirado',
      );
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await this.prisma.$transaction([
      this.prisma.usuario.update({
        where: { id: registro.usuarioId },
        data: { senhaHash },
      }),
      this.prisma.tokenRedefinicaoSenha.delete({ where: { id: registro.id } }),
    ]);

    await this.refreshTokenService.revogarTodosDoUsuario(registro.usuarioId);
  }

  async me(userId: string) {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: userId },
    });
    return {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      cargo: usuario.cargo,
      restauranteId: usuario.restauranteId,
      doisFatoresAtivo: usuario.doisFatoresAtivo,
      emailVerificado: usuario.emailVerificadoEm !== null,
      superAdmin: usuario.superAdmin,
    };
  }
}
