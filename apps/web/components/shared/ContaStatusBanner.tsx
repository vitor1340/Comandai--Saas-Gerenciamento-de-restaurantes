import Link from 'next/link';
import { AlertTriangle, Ban, Clock, IdCard, Mail } from 'lucide-react';
import type { StatusPlano } from '@comandai/shared-types';
import { ReenviarVerificacaoBotao } from './ReenviarVerificacaoBotao';

// Um único banner no topo do painel pra tudo que pode estar travando a
// conta. O usuário SEMPRE consegue entrar no painel (ver métricas, pedidos,
// cardápio); quem barra de verdade as ações de escrita é o
// ContaLiberadaGuard no backend. Este banner só deixa claro o motivo e o
// que fazer — mostra a pendência mais importante primeiro, na mesma ordem
// em que o guard checa.
export function ContaStatusBanner({
  suspenso,
  emailVerificado,
  documentoPendente,
  statusPlano,
  diasRestantesTeste,
}: {
  suspenso: boolean;
  emailVerificado: boolean;
  documentoPendente: boolean;
  statusPlano: StatusPlano;
  diasRestantesTeste: number;
}) {
  if (suspenso) {
    return (
      <Aviso icone={<Ban size={15} className="shrink-0" />}>
        <span>
          Este restaurante foi suspenso e a loja está fora do ar. Fale com o suporte do Comandaí
          para entender o motivo.
        </span>
      </Aviso>
    );
  }

  if (!emailVerificado) {
    return (
      <Aviso icone={<Mail size={15} className="shrink-0" />}>
        <span>
          Confirme seu e-mail para liberar o painel. Enviamos um link para sua caixa de entrada.
        </span>
        <ReenviarVerificacaoBotao />
      </Aviso>
    );
  }

  if (documentoPendente) {
    return (
      <Aviso icone={<IdCard size={15} className="shrink-0" />}>
        <span>Falta só informar o CPF ou CNPJ do restaurante para começar a usar.</span>
        <Link
          href="/onboarding"
          className="ml-auto shrink-0 font-semibold underline underline-offset-2"
        >
          Completar cadastro
        </Link>
      </Aviso>
    );
  }

  if (statusPlano === 'TRIALING') {
    const texto = diasRestantesTeste === 1 ? 'Falta 1 dia' : `Faltam ${diasRestantesTeste} dias`;
    return (
      <div className="px-4 pt-3 md:px-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-brand/20 bg-brand-soft px-4 py-2.5 text-sm text-ink-primary">
          <Clock size={15} className="shrink-0 text-brand" />
          <span>{texto} no seu teste grátis.</span>
          <Link href="/planos" className="ml-auto font-semibold text-brand hover:underline">
            Ver planos
          </Link>
        </div>
      </div>
    );
  }

  if (statusPlano === 'EXPIRED' || statusPlano === 'CANCELED') {
    const texto =
      statusPlano === 'EXPIRED'
        ? 'Seu teste grátis acabou.'
        : 'Sua assinatura foi cancelada.';
    const motivo = statusPlano === 'EXPIRED' ? 'teste-expirado' : 'assinatura-cancelada';
    return (
      <Aviso icone={<AlertTriangle size={15} className="shrink-0" />}>
        <span>
          {texto} Você pode navegar no painel, mas ações como salvar ou criar algo novo ficam
          bloqueadas até assinar um plano.
        </span>
        <Link
          href={`/planos?motivo=${motivo}`}
          className="ml-auto shrink-0 font-semibold underline underline-offset-2"
        >
          Assinar agora
        </Link>
      </Aviso>
    );
  }

  if (statusPlano === 'PAST_DUE') {
    return (
      <Aviso icone={<AlertTriangle size={15} className="shrink-0" />}>
        <span>Não conseguimos confirmar seu último pagamento da assinatura Comandaí.</span>
        <Link
          href="/configuracoes"
          className="ml-auto shrink-0 font-semibold underline underline-offset-2"
        >
          Verificar assinatura
        </Link>
      </Aviso>
    );
  }

  return null;
}

function Aviso({
  icone,
  children,
}: {
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pt-3 md:px-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-danger/25 bg-danger/5 px-4 py-2.5 text-sm text-danger">
        {icone}
        {children}
      </div>
    </div>
  );
}
