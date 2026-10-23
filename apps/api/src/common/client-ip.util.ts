import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

export const HEADER_CLIENT_IP = 'x-comandai-client-ip';
export const HEADER_PROXY_SECRET = 'x-comandai-proxy-secret';

function segredoConfere(recebido: string | undefined): boolean {
  const esperado = process.env.INTERNAL_PROXY_SECRET;
  if (!esperado || !recebido) {
    return false;
  }
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * IP real de quem fez a requisição. As rotas de auth do Next
 * (apps/web/app/api/auth/*) chamam a API pelo servidor — sem isso, todo
 * cadastro/login pelo site chegaria com o IP do servidor Next e o rate
 * limit por IP viraria um limite global. O Next repassa o IP do cliente
 * num header, que só é aceito junto com o segredo compartilhado
 * (INTERNAL_PROXY_SECRET) — senão qualquer um forjaria o header pra fugir
 * do rate limit. Fora isso, vale `req.ip` (com `trust proxy` no main.ts).
 */
export function obterIpCliente(req: Request): string {
  const ipRepassado = req.headers[HEADER_CLIENT_IP];
  const segredo = req.headers[HEADER_PROXY_SECRET];
  if (
    typeof ipRepassado === 'string' &&
    ipRepassado.length > 0 &&
    ipRepassado.length <= 64 &&
    segredoConfere(typeof segredo === 'string' ? segredo : undefined)
  ) {
    return ipRepassado;
  }
  return req.ip ?? 'desconhecido';
}
