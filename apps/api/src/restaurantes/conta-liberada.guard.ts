import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/jwt.types';
import {
  calcularStatusPlano,
  statusPlanoBloqueiaAcesso,
} from './plan-status.util';

/**
 * Códigos devolvidos no corpo do 403 — o frontend usa pra decidir qual
 * aviso mostrar (ContaStatusBanner) sem depender do texto da mensagem.
 */
export const CODIGO_CONTA_SUSPENSA = 'CONTA_SUSPENSA';
export const CODIGO_EMAIL_NAO_VERIFICADO = 'EMAIL_NAO_VERIFICADO';
export const CODIGO_DOCUMENTO_PENDENTE = 'DOCUMENTO_PENDENTE';

/**
 * Não é global — precisa ser adicionado explicitamente junto com o
 * JwtAuthGuard: `@UseGuards(JwtAuthGuard, ContaLiberadaGuard)`, mesma razão
 * do RolesGuard (precisa de `request.user` já populado). Só nas rotas de
 * escrita: leitura continua liberada pro dono ver o que tem e resolver a
 * pendência. Bloqueia, nesta ordem:
 * - restaurante suspenso pelo admin da plataforma (403);
 * - e-mail do usuário não verificado (403);
 * - restaurante sem CPF/CNPJ — cadastro via Google antes do onboarding (403);
 * - teste grátis vencido sem assinatura (EXPIRED) ou assinatura cancelada
 *   (CANCELED) (402). PAST_DUE continua liberado, ver
 *   `statusPlanoBloqueiaAcesso`.
 */
@Injectable()
export class ContaLiberadaGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const usuario = request.user;

    if (!usuario) {
      return true;
    }

    const { emailVerificadoEm, restaurante } =
      await this.prisma.usuario.findUniqueOrThrow({
        where: { id: usuario.userId },
        select: {
          emailVerificadoEm: true,
          restaurante: {
            select: {
              statusAssinatura: true,
              trialEndsAt: true,
              documento: true,
              suspensoEm: true,
            },
          },
        },
      });

    if (restaurante.suspensoEm) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        codigo: CODIGO_CONTA_SUSPENSA,
        message:
          'Este restaurante foi suspenso. Entre em contato com o suporte do Comandaí.',
      });
    }

    if (!emailVerificadoEm) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        codigo: CODIGO_EMAIL_NAO_VERIFICADO,
        message:
          'Confirme seu e-mail para continuar. Enviamos um link para sua caixa de entrada.',
      });
    }

    if (!restaurante.documento) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        codigo: CODIGO_DOCUMENTO_PENDENTE,
        message:
          'Informe o CPF ou CNPJ do restaurante para continuar usando o Comandaí.',
      });
    }

    // Kill switch: DESATIVAR_BLOQUEIO_PLANO=true desliga só o bloqueio por
    // plano (as pendências acima continuam valendo). Não usar em produção
    // com cobrança ativa — ver .env.example.
    if (process.env.DESATIVAR_BLOQUEIO_PLANO === 'true') {
      return true;
    }

    const status = calcularStatusPlano(restaurante);
    if (statusPlanoBloqueiaAcesso(status)) {
      const mensagem =
        status === 'CANCELED'
          ? 'Sua assinatura do Comandaí foi cancelada. Escolha um plano para continuar usando o Comandaí.'
          : 'Seu teste grátis acabou. Escolha um plano para continuar usando o Comandaí.';
      throw new HttpException(mensagem, HttpStatus.PAYMENT_REQUIRED);
    }

    return true;
  }
}
