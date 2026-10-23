import { StatusAssinatura } from '../../generated/prisma/client';

// EXPIRED não é um valor armazenado — é só o que TRIALING vira depois de
// trialEndsAt, calculado aqui na hora. Isso evita ter um status "expired"
// gravado que pode ficar desatualizado se a regra de prazo mudar.
export type StatusPlanoCalculado = `${StatusAssinatura}` | 'EXPIRED';

interface DadosStatusPlano {
  statusAssinatura: StatusAssinatura;
  trialEndsAt: Date;
}

/**
 * Único lugar que decide se um restaurante ainda tem acesso ao app.
 * Usado tanto pelo ContaLiberadaGuard (backend) quanto por RestaurantesService
 * (pro frontend consultar via /restaurantes/me) — não duplicar essa conta
 * de data em outro lugar.
 */
export function calcularStatusPlano(
  restaurante: DadosStatusPlano,
  agora: Date = new Date(),
): StatusPlanoCalculado {
  if (restaurante.statusAssinatura === StatusAssinatura.TRIALING) {
    return agora < restaurante.trialEndsAt ? 'TRIALING' : 'EXPIRED';
  }
  return restaurante.statusAssinatura;
}

export function calcularDiasRestantesTeste(
  trialEndsAt: Date,
  agora: Date = new Date(),
): number {
  const diffMs = trialEndsAt.getTime() - agora.getTime();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

// PAST_DUE não bloqueia: o Mercado Pago já faz seu próprio retry/dunning de
// cobrança falha antes de pausar ou cancelar a assinatura. Só EXPIRED
// (teste grátis vencido sem assinatura) e CANCELED bloqueiam o acesso.
const STATUS_BLOQUEIAM_ACESSO = new Set<StatusPlanoCalculado>([
  'EXPIRED',
  'CANCELED',
]);

export function statusPlanoBloqueiaAcesso(
  status: StatusPlanoCalculado,
): boolean {
  return STATUS_BLOQUEIAM_ACESSO.has(status);
}
