import { apiFetch } from '@/lib/api-client';
import { getSessionToken } from '@/lib/session.server';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AuthBootstrap } from '@/components/shared/AuthBootstrap';
import { ContaStatusBanner } from '@/components/shared/ContaStatusBanner';
import type { RestauranteMeDTO, UsuarioMeDTO } from '@comandai/shared-types';

// Com alguma pendência (e-mail não confirmado, CPF/CNPJ faltando, plano
// vencido, conta suspensa), o usuário continua entrando no painel
// normalmente — só ações de escrita (salvar, criar, etc.) são bloqueadas
// pelo ContaLiberadaGuard no backend. O ContaStatusBanner deixa o motivo
// visível o tempo todo, em vez de expulsar pra outra tela antes de mostrar
// qualquer coisa.
export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const token = await getSessionToken();
  const [restaurante, usuario] = await Promise.all([
    apiFetch<RestauranteMeDTO>('/restaurantes/me', token),
    apiFetch<UsuarioMeDTO>('/auth/me', token),
  ]);

  return (
    <div className="flex">
      <AuthBootstrap />
      <Sidebar
        restauranteNome={restaurante.nome}
        restaurantePlano={restaurante.plano}
        pedidosNovosCount={restaurante.pedidosNovosCount}
        superAdmin={usuario.superAdmin}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Header lojaAberta={restaurante.aberto} />
        <ContaStatusBanner
          suspenso={restaurante.suspenso}
          emailVerificado={usuario.emailVerificado}
          documentoPendente={restaurante.documentoPendente}
          statusPlano={restaurante.statusPlano}
          diasRestantesTeste={restaurante.diasRestantesTeste}
        />
        <main className="min-w-0 flex-1 bg-page p-6">{children}</main>
      </div>
    </div>
  );
}
