import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { getSessionToken } from '@/lib/session.server';
import type { AdminRestaurantesPaginaDTO, UsuarioMeDTO } from '@comandai/shared-types';
import { AdminRestaurantes } from '@/components/admin/AdminRestaurantes';

export default async function AdminPage() {
  const token = await getSessionToken();
  const usuario = await apiFetch<UsuarioMeDTO>('/auth/me', token);
  // A API também barra (SuperAdminGuard) — aqui é só pra não revelar que a
  // página existe.
  if (!usuario.superAdmin) {
    notFound();
  }

  const paginaInicial = await apiFetch<AdminRestaurantesPaginaDTO>('/admin/restaurantes', token);

  return <AdminRestaurantes paginaInicial={paginaInicial} />;
}
