'use client';

import { useState } from 'react';
import type {
  AdminRestauranteDTO,
  AdminRestaurantesPaginaDTO,
  AtualizarRestauranteAdminDTO,
  StatusPlano,
} from '@comandai/shared-types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { obterTokenValido } from '@/lib/client-token';

const STATUS_LABEL: Record<StatusPlano, string> = {
  TRIALING: 'Teste',
  ACTIVE: 'Ativa',
  EXPIRED: 'Teste vencido',
  PAST_DUE: 'Pagamento pendente',
  CANCELED: 'Cancelada',
};

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function AdminRestaurantes({
  paginaInicial,
}: {
  paginaInicial: AdminRestaurantesPaginaDTO;
}) {
  const [pagina, setPagina] = useState(paginaInicial);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar(numeroPagina: number, termo = busca) {
    setCarregando(true);
    setErro(null);
    try {
      const token = await obterTokenValido();
      const params = new URLSearchParams({ pagina: String(numeroPagina) });
      if (termo.trim()) params.set('busca', termo.trim());
      setPagina(
        await apiFetch<AdminRestaurantesPaginaDTO>(
          `/admin/restaurantes?${params.toString()}`,
          token ?? undefined,
        ),
      );
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Falha ao carregar.');
    } finally {
      setCarregando(false);
    }
  }

  async function atualizar(restaurante: AdminRestauranteDTO, dados: AtualizarRestauranteAdminDTO) {
    if (
      dados.suspenso &&
      !window.confirm(`Suspender "${restaurante.nome}"? A loja sai do ar e o painel trava.`)
    ) {
      return;
    }
    setErro(null);
    try {
      const token = await obterTokenValido();
      await apiFetch(`/admin/restaurantes/${restaurante.id}`, token ?? undefined, {
        method: 'PATCH',
        body: JSON.stringify(dados),
      });
      await carregar(pagina.pagina);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Falha ao atualizar.');
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.itensPorPagina));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Restaurantes</h1>
        <p className="text-sm text-ink-secondary">{pagina.total} cadastrados no Comandaí.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void carregar(1);
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome, slug, e-mail, CPF/CNPJ ou IP"
          className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button
          type="submit"
          disabled={carregando}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          Buscar
        </button>
      </form>

      {erro && <p className="text-sm text-danger">{erro}</p>}

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase text-ink-muted">
            <tr>
              <th className="px-4 py-3">Restaurante</th>
              <th className="px-4 py-3">Dono</th>
              <th className="px-4 py-3">Documento</th>
              <th className="px-4 py-3">Plano</th>
              <th className="px-4 py-3">Uso</th>
              <th className="px-4 py-3">Cadastro</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {pagina.itens.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink-primary">{r.nome}</p>
                  <a
                    href={`/loja/${r.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-brand hover:underline"
                  >
                    /loja/{r.slug}
                  </a>
                  {r.suspenso && (
                    <span className="ml-2 rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
                      SUSPENSO
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="text-ink-primary">{r.emailDono ?? '—'}</p>
                  <p className="text-xs text-ink-muted">
                    {r.emailVerificado ? 'e-mail verificado' : 'e-mail NÃO verificado'}
                    {r.loginGoogle && ' · Google'}
                  </p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-secondary">
                  {r.documento ?? 'pendente'}
                </td>
                <td className="px-4 py-3">
                  <p className="text-ink-primary">{STATUS_LABEL[r.statusPlano]}</p>
                  {r.statusPlano === 'TRIALING' || r.statusPlano === 'EXPIRED' ? (
                    <p className="text-xs text-ink-muted">até {formatarData(r.trialEndsAt)}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs text-ink-secondary">
                  {r.produtosCount} produtos · {r.pedidosCount} pedidos
                </td>
                <td className="px-4 py-3 text-xs text-ink-secondary">
                  <p>{formatarData(r.createdAt)}</p>
                  {r.ipCadastro && (
                    <button
                      type="button"
                      onClick={() => {
                        setBusca(r.ipCadastro ?? '');
                        void carregar(1, r.ipCadastro ?? '');
                      }}
                      className="font-mono text-brand hover:underline"
                      title="Ver outros cadastros deste IP"
                    >
                      {r.ipCadastro}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {(r.statusPlano === 'TRIALING' || r.statusPlano === 'EXPIRED') && (
                      <button
                        type="button"
                        onClick={() => atualizar(r, { estenderTrialDias: 7 })}
                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-ink-primary hover:bg-page"
                      >
                        +7 dias
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => atualizar(r, { suspenso: !r.suspenso })}
                      className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                        r.suspenso
                          ? 'border border-border text-ink-primary hover:bg-page'
                          : 'bg-danger text-white hover:opacity-90'
                      }`}
                    >
                      {r.suspenso ? 'Reativar' : 'Suspender'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {pagina.itens.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                  Nenhum restaurante encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-ink-secondary">
        <span>
          Página {pagina.pagina} de {totalPaginas}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={carregando || pagina.pagina <= 1}
            onClick={() => carregar(pagina.pagina - 1)}
            className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={carregando || pagina.pagina >= totalPaginas}
            onClick={() => carregar(pagina.pagina + 1)}
            className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
