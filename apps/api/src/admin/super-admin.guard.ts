import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/jwt.types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Admin da plataforma. Consulta o banco a cada requisição em vez de levar a
 * flag no JWT — tirar o acesso de alguém tem efeito imediato, sem esperar
 * o access token expirar. Usar depois do JwtAuthGuard.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const usuario = request.user;

    const registro = usuario
      ? await this.prisma.usuario.findUnique({
          where: { id: usuario.userId },
          select: { superAdmin: true },
        })
      : null;

    if (!registro?.superAdmin) {
      throw new ForbiddenException('Acesso restrito');
    }
    return true;
  }
}
