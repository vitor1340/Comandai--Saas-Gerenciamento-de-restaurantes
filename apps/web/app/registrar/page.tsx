'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LoginResponseDTO } from '@comandai/shared-types';
import { setSessionCookie } from '@/lib/auth-cookie';
import { mensagemDeErro } from '@/lib/api-client';
import { mascararCpfCnpj } from '@/lib/documento';
import { useAuthStore } from '@/store/auth-store';
import { AuthBrandHeader } from '@/components/shared/AuthBrandHeader';
import { Turnstile, TURNSTILE_ATIVO } from '@/components/auth/Turnstile';

export default function RegistrarPage() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [nomeRestaurante, setNomeRestaurante] = useState('');
  const [nomeDono, setNomeDono] = useState('');
  const [documento, setDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
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
    let sucesso = false;

    try {
      const response = await fetch('/api/auth/registrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomeRestaurante,
          nomeDono,
          documento,
          email,
          senha,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });

      if (response.status === 429) {
        setErro('Muitas tentativas. Aguarde um minuto e tente de novo.');
        return;
      }
      if (!response.ok) {
        setErro(
          (await mensagemDeErro(response)) ??
            'Não foi possível criar sua conta. Confira os dados e tente novamente.',
        );
        return;
      }

      const data: LoginResponseDTO = await response.json();
      sucesso = true;
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
    <main className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <AuthBrandHeader />

        <h1 className="mb-1 text-xl font-semibold text-ink-primary">Criar seu restaurante</h1>
        <p className="mb-6 text-sm text-ink-secondary">
          Leva menos de um minuto. Você ganha 7 dias grátis para testar.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="nomeRestaurante"
              className="mb-1 block text-sm font-medium text-ink-primary"
            >
              Nome do restaurante
            </label>
            <input
              id="nomeRestaurante"
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={nomeRestaurante}
              onChange={(e) => setNomeRestaurante(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>

          <div>
            <label htmlFor="documento" className="mb-1 block text-sm font-medium text-ink-primary">
              CPF ou CNPJ
            </label>
            <input
              id="documento"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              required
              placeholder="000.000.000-00"
              value={documento}
              onChange={(e) => setDocumento(mascararCpfCnpj(e.target.value))}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <p className="mt-1 text-xs text-ink-muted">
              Um teste grátis por CPF/CNPJ. Usamos só para identificar o restaurante.
            </p>
          </div>

          <div>
            <label htmlFor="nomeDono" className="mb-1 block text-sm font-medium text-ink-primary">
              Seu nome
            </label>
            <input
              id="nomeDono"
              type="text"
              required
              minLength={2}
              maxLength={100}
              value={nomeDono}
              onChange={(e) => setNomeDono(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink-primary">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <p className="mt-1 text-xs text-ink-muted">
              Vamos enviar um link de confirmação para este e-mail.
            </p>
          </div>

          <div>
            <label htmlFor="senha" className="mb-1 block text-sm font-medium text-ink-primary">
              Senha
            </label>
            <input
              id="senha"
              type="password"
              required
              minLength={8}
              maxLength={72}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <p className="mt-1 text-xs text-ink-muted">Mínimo de 8 caracteres.</p>
          </div>

          <Turnstile key={turnstileKey} onToken={setTurnstileToken} />

          {erro && <p className="text-sm text-danger">{erro}</p>}

          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {carregando ? 'Criando...' : 'Criar conta'}
          </button>

          <p className="text-center text-xs text-ink-muted">
            Ao criar conta, você concorda com os{' '}
            <Link href="/termos" className="font-medium text-brand hover:underline">
              Termos de Uso
            </Link>{' '}
            e a{' '}
            <Link href="/privacidade" className="font-medium text-brand hover:underline">
              Política de Privacidade
            </Link>
            .
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-ink-secondary">
          Já tem uma conta?{' '}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
