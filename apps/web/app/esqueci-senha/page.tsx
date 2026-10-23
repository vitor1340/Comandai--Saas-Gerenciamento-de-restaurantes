'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AuthBrandHeader } from '@/components/shared/AuthBrandHeader';
import { Turnstile, TURNSTILE_ATIVO } from '@/components/auth/Turnstile';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);

    if (TURNSTILE_ATIVO && !turnstileToken) {
      setErro('Aguarde a verificação anti-robô terminar.');
      return;
    }

    setCarregando(true);

    try {
      const response = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken: turnstileToken ?? undefined }),
      });

      if (!response.ok) {
        setErro('Não foi possível processar seu pedido. Confira o e-mail informado.');
        return;
      }

      // Resposta é sempre genérica de propósito (não revela se o e-mail existe).
      setEnviado(true);
    } catch {
      setErro('Não foi possível conectar ao servidor.');
    } finally {
      setCarregando(false);
      // Token do Turnstile é de uso único.
      setTurnstileToken(null);
      setTurnstileKey((k) => k + 1);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <AuthBrandHeader />

        {enviado ? (
          <>
            <h1 className="mb-1 text-xl font-semibold text-ink-primary">Verifique seu e-mail</h1>
            <p className="mb-6 text-sm text-ink-secondary">
              Se <strong>{email}</strong> estiver cadastrado, você vai receber um link para
              redefinir sua senha em instantes.
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-1 text-xl font-semibold text-ink-primary">Esqueceu sua senha?</h1>
            <p className="mb-6 text-sm text-ink-secondary">
              Informe o e-mail da sua conta e enviaremos um link para redefinir a senha.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink-primary">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>

              <Turnstile key={turnstileKey} onToken={setTurnstileToken} />

              {erro && <p className="text-sm text-danger">{erro}</p>}

              <button
                type="submit"
                disabled={carregando}
                className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {carregando ? 'Enviando...' : 'Enviar link de redefinição'}
              </button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-sm text-ink-secondary">
          Lembrou a senha?{' '}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
