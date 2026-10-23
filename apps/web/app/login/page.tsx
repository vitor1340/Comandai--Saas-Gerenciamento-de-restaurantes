'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoginResultDTO } from '@comandai/shared-types';
import { setSessionCookie } from '@/lib/auth-cookie';
import { useAuthStore } from '@/store/auth-store';
import { SignInPage } from '@/components/ui/sign-in';
import { Turnstile, TURNSTILE_ATIVO } from '@/components/auth/Turnstile';
import { mensagemDeErro } from '@/lib/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);

    if (TURNSTILE_ATIVO && !turnstileToken) {
      setErro('Aguarde a verificação anti-robô terminar.');
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '');
    const senha = String(formData.get('password') ?? '');

    setCarregando(true);
    let sucesso = false;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha, turnstileToken: turnstileToken ?? undefined }),
      });

      if (response.status === 429) {
        setErro('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
        return;
      }
      if (!response.ok && response.status !== 401) {
        setErro((await mensagemDeErro(response)) ?? 'E-mail ou senha inválidos.');
        return;
      }
      if (!response.ok) {
        setErro('E-mail ou senha inválidos.');
        return;
      }

      const data: LoginResultDTO = await response.json();
      sucesso = true;

      if ('requiresTwoFactor' in data) {
        router.push(`/verificar-2fa?tempToken=${encodeURIComponent(data.tempToken)}`);
        return;
      }

      setSessionCookie(data.accessToken);
      setSession(data.usuario, data.accessToken);
      router.push('/dashboard');
      router.refresh();
    } catch {
      setErro('Não foi possível conectar ao servidor.');
    } finally {
      setCarregando(false);
      // Token do Turnstile é de uso único — gera outro pra próxima tentativa.
      if (!sucesso) {
        setTurnstileToken(null);
        setTurnstileKey((k) => k + 1);
      }
    }
  }

  return (
    <SignInPage
      title={<span className="font-light text-foreground tracking-tighter">Bem-vindo de volta</span>}
      description="Acesse com o e-mail e senha do seu restaurante."
      heroImageSrc="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=2160&q=80"
      errorMessage={erro ?? undefined}
      isLoading={carregando}
      onSignIn={handleSignIn}
      captcha={<Turnstile key={turnstileKey} onToken={setTurnstileToken} />}
      onGoogleSignIn={() => {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- navegação de página inteira pro backend (não é uma rota do Next.js), necessária pro handshake OAuth
        window.location.href = `${API_URL}/auth/google`;
      }}
      onResetPassword={() => router.push('/esqueci-senha')}
      onCreateAccount={() => router.push('/registrar')}
    />
  );
}
