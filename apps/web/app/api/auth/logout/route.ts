import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { REFRESH_COOKIE, clearRefreshCookie } from '@/lib/refresh-cookie';
import { headersProxyApi } from '@/lib/api-proxy-headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: headersProxyApi(request),
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }

  clearRefreshCookie(cookieStore);
  return NextResponse.json({ mensagem: 'Sessão encerrada.' });
}
