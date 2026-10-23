'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEM_ADMIN, NAV_ITEMS } from './nav-items';
import { RestaurantSwitcher } from './RestaurantSwitcher';
import { HelpCard } from './HelpCard';
import { Dock, DockItem, DockIcon } from '@/components/ui/dock';
import { useUiStore } from '@/store/ui-store';
import { Logo } from '@/components/shared/Logo';

export function Sidebar({
  restauranteNome,
  restaurantePlano,
  pedidosNovosCount,
  superAdmin,
}: {
  restauranteNome: string;
  restaurantePlano: string;
  pedidosNovosCount: number;
  superAdmin: boolean;
}) {
  const itens = superAdmin ? [...NAV_ITEMS, NAV_ITEM_ADMIN] : NAV_ITEMS;
  const pathname = usePathname();
  const menuMobileAberto = useUiStore((state) => state.menuMobileAberto);
  const fecharMenuMobile = useUiStore((state) => state.fecharMenuMobile);

  return (
    <>
      {menuMobileAberto && (
        <div
          aria-hidden
          onClick={fecharMenuMobile}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface p-4 transition-transform duration-200 md:static md:translate-x-0 ${
          menuMobileAberto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      <div className="mb-6 flex items-center gap-2 px-1">
        <Logo className="h-8 w-8" />
        <div className="leading-tight">
          <p className="text-sm font-bold text-ink-primary">Comandaí</p>
          <p className="text-[10px] tracking-wide text-ink-muted">PARCEIROS</p>
        </div>
      </div>

      <RestaurantSwitcher nome={restauranteNome} plano={restaurantePlano} />

      <Dock className="mt-6 flex-1 space-y-1 overflow-y-auto">
        {itens.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          const badge = item.badgeKey === 'pedidosNovos' ? pedidosNovosCount : undefined;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={fecharMenuMobile}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? 'bg-brand-soft text-brand'
                  : 'text-ink-secondary hover:bg-page hover:text-ink-primary'
              }`}
            >
              <DockItem>
                <DockIcon>
                  <item.icon className="h-full w-full" />
                </DockIcon>
              </DockItem>
              <span className="flex-1">{item.label}</span>
              {!!badge && (
                <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </Dock>

      <HelpCard />
      </aside>
    </>
  );
}
