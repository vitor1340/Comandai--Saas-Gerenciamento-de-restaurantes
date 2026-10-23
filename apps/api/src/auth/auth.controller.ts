import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { obterIpCliente } from '../common/client-ip.util';
import { exigirVariavelAmbiente } from '../common/env.util';
import { AuthService } from './auth.service';
import { Ativar2faDto } from './dto/ativar-2fa.dto';
import { Desativar2faDto } from './dto/desativar-2fa.dto';
import { EsqueciSenhaDto } from './dto/esqueci-senha.dto';
import { LoginDto } from './dto/login.dto';
import { RedefinirSenhaDto } from './dto/redefinir-senha.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegistrarDto } from './dto/registrar.dto';
import { TrocarCodigoGoogleDto } from './dto/trocar-codigo-google.dto';
import { Verificar2faDto } from './dto/verificar-2fa.dto';
import { VerificarEmailDto } from './dto/verificar-email.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './jwt.types';
import type { UsuarioGoogle } from './google.types';
import type { RefreshTokenMeta } from './refresh-token.service';
import { TwoFactorService } from './two-factor.service';

const LIMITE_TENTATIVAS_AUTH = { default: { limit: 5, ttl: 60_000 } };

const LIMITE_REENVIO_VERIFICACAO = { default: { limit: 1, ttl: 60_000 } };

function extrairMeta(req: Request): RefreshTokenMeta {
  return {
    userAgent: req.headers['user-agent'],
    ip: obterIpCliente(req),
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      dto.email,
      dto.senha,
      extrairMeta(req),
      dto.turnstileToken,
    );
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @Post('registrar')
  registrar(@Body() dto: RegistrarDto, @Req() req: Request) {
    return this.authService.registrar(dto, extrairMeta(req));
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @Post('verificar-email')
  async verificarEmail(@Body() dto: VerificarEmailDto) {
    await this.authService.verificarEmail(dto.token);
    return { mensagem: 'E-mail confirmado.' };
  }

  @Throttle(LIMITE_REENVIO_VERIFICACAO)
  @UseGuards(JwtAuthGuard)
  @Post('reenviar-verificacao')
  async reenviarVerificacao(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.reenviarEmailVerificacao(user.userId);
    return {
      mensagem: 'Se o e-mail ainda não foi confirmado, enviamos um novo link.',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.userId);
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, extrairMeta(req));
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { mensagem: 'Sessão encerrada.' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutTodasSessoes(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logoutTodasSessoes(user.userId);
    return { mensagem: 'Todas as sessões foram encerradas.' };
  }

  @UseGuards(AuthGuard('google'))
  @Get('google')
  iniciarGoogle() {
    // Passport intercepta a requisição antes daqui e redireciona pro Google.
  }

  @UseGuards(AuthGuard('google'))
  @Get('google/callback')
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const usuarioGoogle = req.user as UsuarioGoogle;
    const resultado = await this.authService.loginOuRegistrarComGoogle(
      usuarioGoogle,
      extrairMeta(req),
    );

    const origemFrontend = exigirVariavelAmbiente('CORS_ORIGIN');

    if ('requiresTwoFactor' in resultado) {
      res.redirect(
        `${origemFrontend}/verificar-2fa?tempToken=${resultado.tempToken}`,
      );
      return;
    }

    const codigo = this.authService.criarCodigoTrocaTemporario(
      resultado.accessToken,
      resultado.refreshToken,
      resultado.usuario,
    );
    res.redirect(`${origemFrontend}/auth/google/callback?code=${codigo}`);
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setupDoisFatores(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactorService.gerarSetup(user.userId);
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  ativarDoisFatores(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: Ativar2faDto,
  ) {
    return this.twoFactorService.confirmarAtivacao(user.userId, dto.codigo);
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @Post('2fa/verify')
  verificarDoisFatores(@Body() dto: Verificar2faDto, @Req() req: Request) {
    return this.authService.verificarDoisFatores(
      dto.tempToken,
      dto.codigo,
      extrairMeta(req),
    );
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  async desativarDoisFatores(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: Desativar2faDto,
  ) {
    await this.twoFactorService.desativar(user.userId, dto.senha);
    return { mensagem: 'Autenticação de dois fatores desativada.' };
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @Post('google/exchange')
  trocarCodigoGoogle(@Body() dto: TrocarCodigoGoogleDto) {
    return this.authService.trocarCodigoTemporario(dto.codigo);
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @Post('forgot-password')
  async esqueciSenha(@Body() dto: EsqueciSenhaDto, @Req() req: Request) {
    await this.authService.solicitarRedefinicaoSenha(
      dto.email,
      obterIpCliente(req),
      dto.turnstileToken,
    );
    return {
      mensagem:
        'Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha.',
    };
  }

  @Throttle(LIMITE_TENTATIVAS_AUTH)
  @Post('reset-password')
  async redefinirSenha(@Body() dto: RedefinirSenhaDto) {
    await this.authService.redefinirSenha(dto.token, dto.novaSenha);
    return { mensagem: 'Senha redefinida com sucesso.' };
  }
}
