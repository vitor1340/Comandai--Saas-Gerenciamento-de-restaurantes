import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from './lib/auth-cookie';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './lib/refresh-cookie';
import { headersProxyApi } from './lib/api-proxy-headers';

const ROTAS_PUBLICAS = [
  '/login',
  '/registrar',
  '/auth/google/callback',
  '/esqueci-senha',
  '/redefinir-senha',
  '/verificar-2fa',
];
// Diferente de ROTAS_PUBLICAS: não expulsam um usuário já logado (conteúdo
// estático que faz sentido consultar estando autenticado ou não).
const ROTAS_SEMPRE_ACESSIVEIS = ['/privacidade', '/termos', '/planos', '/verificar-email'];
const PREFIXO_LOJA_PUBLICA = '/loja/';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith(PREFIXO_LOJA_PUBLICA) ||
    ROTAS_SEMPRE_ACESSIVEIS.includes(pathname)
  ) {
    return NextResponse.next();
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const temSessao = Boolean(refreshToken);
  const rotaPublica = ROTAS_PUBLICAS.includes(pathname);

  if (!temSessao && !rotaPublica) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (temSessao && rotaPublica) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Access token (comandai_session) dura 15min; quando expira mas ainda há
  // refresh token, renova silenciosamente antes de deixar a página renderizar
  // — cobre os Server Components, que só conseguem ler o token via cookie.
  if (temSessao && !request.cookies.has(SESSION_COOKIE)) {
    return renovarSessao(request, refreshToken!, rotaPublica);
  }

  return NextResponse.next();
}

async function renovarSessao(
  request: NextRequest,
  refreshToken: string,
  rotaPublica: boolean,
): Promise<NextResponse> {
  try {
    const resposta = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: headersProxyApi(request),
      body: JSON.stringify({ refreshToken }),
    });

    if (!resposta.ok) {
      const redirecionamento = rotaPublica
        ? NextResponse.next()
        : NextResponse.redirect(new URL('/login', request.url));
      clearRefreshCookie(redirecionamento.cookies);
      return redirecionamento;
    }

    const dados = (await resposta.json()) as {
      accessToken: string;
      refreshToken: string;
    };

    const seguir = NextResponse.next();
    seguir.cookies.set(SESSION_COOKIE, dados.accessToken, {
      path: '/',
      maxAge: 60 * 15,
      sameSite: 'lax',
    });
    setRefreshCookie(seguir.cookies, dados.refreshToken);
    return seguir;
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
