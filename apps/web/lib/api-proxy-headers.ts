import 'server-only';

/**
 * Headers pras rotas de auth do Next (app/api/auth/*) que chamam a API pelo
 * servidor. Sem repassar o IP do cliente, a API veria todo cadastro/login
 * vindo do IP deste servidor e o rate limit por IP viraria um limite global
 * — ver obterIpCliente em apps/api/src/common/client-ip.util.ts. O segredo
 * prova pra API que o header veio daqui, e não de alguém forjando.
 */
export function headersProxyApi(request: Request): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const segredo = process.env.INTERNAL_PROXY_SECRET;
  const ip = ipCliente(request);
  if (segredo && ip) {
    headers['X-Comandai-Client-IP'] = ip;
    headers['X-Comandai-Proxy-Secret'] = segredo;
  }
  const userAgent = request.headers.get('user-agent');
  if (userAgent) {
    headers['User-Agent'] = userAgent;
  }
  return headers;
}

// X-Real-IP é setado pelo proxy da hospedagem; no X-Forwarded-For o último
// item é o que o proxy acrescentou (os anteriores o cliente pode forjar).
function ipCliente(request: Request): string | null {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const encaminhado = request.headers.get('x-forwarded-for');
  const ultimo = encaminhado?.split(',').pop()?.trim();
  return ultimo || null;
}
