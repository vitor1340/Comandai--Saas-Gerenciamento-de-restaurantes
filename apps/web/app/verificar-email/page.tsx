'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthBrandHeader } from '@/components/shared/AuthBrandHeader';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

type Estado = 'verificando' | 'sucesso' | 'erro';

function VerificarEmailConteudo() {
  const token = useSearchParams().get('token');
  const [estado, setEstado] = useState<Estado>(token ? 'verificando' : 'erro');
  // O token é de uso único — em dev o StrictMode roda o efeito duas vezes,
  // e a segunda chamada falharia mostrando erro mesmo com sucesso.
  const jaEnviou = useRef(false);

  useEffect(() => {
    if (!token || jaEnviou.current) return;
    jaEnviou.current = true;

    fetch(`${API_URL}/auth/verificar-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((resposta) => setEstado(resposta.ok ? 'sucesso' : 'erro'))
      .catch(() => setEstado('erro'));
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <AuthBrandHeader />

        {estado === 'verificando' && (
          <p className="text-sm text-ink-secondary">Confirmando seu e-mail...</p>
        )}

        {estado === 'sucesso' && (
          <>
            <h1 className="mb-1 text-xl font-semibold text-ink-primary">E-mail confirmado!</h1>
            <p className="mb-6 text-sm text-ink-secondary">
              Pronto. Agora você pode usar o Comandaí normalmente.
            </p>
            <Link
              href="/dashboard"
              className="inline-block w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Ir para o painel
            </Link>
          </>
        )}

        {estado === 'erro' && (
          <>
            <h1 className="mb-1 text-xl font-semibold text-ink-primary">Link inválido</h1>
            <p className="mb-6 text-sm text-ink-secondary">
              Este link de confirmação é inválido ou já expirou. Entre no painel e peça um novo
              pelo aviso no topo da tela.
            </p>
            <Link href="/dashboard" className="text-sm font-semibold text-brand hover:underline">
              Ir para o painel
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerificarEmailPage() {
  return (
    <Suspense>
      <VerificarEmailConteudo />
    </Suspense>
  );
}
