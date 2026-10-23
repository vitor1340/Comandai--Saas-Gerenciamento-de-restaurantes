import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { LoginComRefreshResponseDTO } from '@comandai/shared-types';
import { setRefreshCookie } from '@/lib/refresh-cookie';
import { headersProxyApi } from '@/lib/api-proxy-headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export async function POST(request: Request) {
  const corpo = await request.text();

  const resposta = await fetch(`${API_URL}/auth/registrar`, {
    method: 'POST',
    headers: headersProxyApi(request),
    body: corpo,
  });

  if (!resposta.ok) {
    return new NextResponse(await resposta.text(), { status: resposta.status });
  }

  const dados: LoginComRefreshResponseDTO = await resposta.json();
  const cookieStore = await cookies();
  setRefreshCookie(cookieStore, dados.refreshToken);

  return NextResponse.json({ accessToken: dados.accessToken, usuario: dados.usuario });
}
