'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { obterTokenValido } from '@/lib/client-token';

export function ReenviarVerificacaoBotao() {
  const [estado, setEstado] = useState<'ocioso' | 'enviando' | 'enviado' | 'erro'>('ocioso');

  async function reenviar() {
    setEstado('enviando');
    try {
      const token = await obterTokenValido();
      await apiFetch('/auth/reenviar-verificacao', token ?? undefined, { method: 'POST' });
      setEstado('enviado');
    } catch {
      // 429 = já pediu há menos de 1 minuto.
      setEstado('erro');
    }
  }

  if (estado === 'enviado') {
    return <span className="ml-auto shrink-0 font-semibold">Link reenviado!</span>;
  }

  return (
    <button
      type="button"
      onClick={reenviar}
      disabled={estado === 'enviando'}
      className="ml-auto shrink-0 font-semibold underline underline-offset-2 disabled:opacity-60"
    >
      {estado === 'erro' ? 'Aguarde 1 minuto e tente de novo' : 'Reenviar e-mail'}
    </button>
  );
}
