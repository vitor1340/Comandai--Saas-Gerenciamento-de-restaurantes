'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CompletarCadastroDTO, RestauranteMeDTO } from '@comandai/shared-types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { obterTokenValido } from '@/lib/client-token';
import { mascararCpfCnpj } from '@/lib/documento';

// Quem entra com Google cai aqui pelo ContaStatusBanner: o restaurante foi
// criado com um nome automático e sem CPF/CNPJ, e o painel fica travado pra
// escrita até completar.
export default function OnboardingPage() {
  const router = useRouter();
  const [nomeRestaurante, setNomeRestaurante] = useState('');
  const [documento, setDocumento] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setSalvando(true);

    try {
      const token = await obterTokenValido();
      const corpo: CompletarCadastroDTO = { documento, nomeRestaurante };
      await apiFetch<RestauranteMeDTO>('/restaurantes/me/documento', token ?? undefined, {
        method: 'PATCH',
        body: JSON.stringify(corpo),
      });
      router.push('/dashboard');
      router.refresh();
    } catch (e) {
      setErro(
        e instanceof ApiError ? e.message : 'Não foi possível salvar agora. Tente de novo.',
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-xl font-semibold text-ink-primary">Complete seu cadastro</h1>
      <p className="mb-6 text-sm text-ink-secondary">
        Falta pouco. Informe o nome do seu restaurante e o CPF ou CNPJ do responsável.
      </p>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
      >
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
            Um teste grátis por CPF/CNPJ. Não dá para trocar depois de salvo.
          </p>
        </div>

        {erro && <p className="text-sm text-danger">{erro}</p>}

        <button
          type="submit"
          disabled={salvando}
          className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {salvando ? 'Salvando...' : 'Salvar e continuar'}
        </button>
      </form>
    </div>
  );
}
