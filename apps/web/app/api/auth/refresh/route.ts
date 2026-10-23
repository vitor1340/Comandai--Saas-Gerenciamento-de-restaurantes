import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { RefreshResponseDTO } from '@comandai/shared-types';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from '@/lib/refresh-cookie';
import { headersProxyApi } from '@/lib/api-proxy-headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ mensagem: 'Sem sessão ativa' }, { status: 401 });
  }

  const resposta = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: headersProxyApi(request),
    body: JSON.stringify({ refreshToken }),
  });

  if (!resposta.ok) {
    clearRefreshCookie(cookieStore);
    return new NextResponse(await resposta.text(), { status: resposta.status });
  }

  const dados: RefreshResponseDTO = await resposta.json();
  setRefreshCookie(cookieStore, dados.refreshToken);

  return NextResponse.json({ accessToken: dados.accessToken });
}
