'use client';

import { CalendarDays, CalendarPlus, Home, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BottomNavAccount } from '@/components/bottom-nav-account';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { RoleSlug } from '@/lib/roles';
import { cn } from '@/lib/utils';

export function PhotographerBottomNav({
  user,
  activeRole,
  navLabels,
}: {
  user: { name: string; email: string; avatar?: string | null };
  activeRole: RoleSlug;
  navLabels: {
    overview: string;
    events: string;
    createEvent: string;
    /** Sales/Ventas — renamed from Earnings/Ganancias (T-075). */
    sales: string;
    account: string;
    /** Generic "Role" label (e.g. en="Role", es="Rol"). Prefix for the role row. */
    activeRoleLabel: string;
    /** Localized photographer role name shown after `activeRoleLabel:` (e.g. "Photographer"). */
    roleLabel: string;
    profile: string;
    settings: string;
    support: string;
    feedback: string;
    switchToTalent: string;
    logOut: string;
  };
}) {
  const pathname = usePathname();
  const lp = useLocalizedPath();

  const navLinks = [
    {
      href: '/dashboard/photographer',
      label: navLabels.overview,
      icon: Home,
      isActive: (p: string) => {
        const clean = p.replace(/^\/(es|en)/, '');
        return clean === '/dashboard/photographer';
      },
    },
    {
      href: '/dashboard/photographer/events',
      label: navLabels.events,
      icon: CalendarDays,
      isActive: (p: string) => {
        const clean = p.replace(/^\/(es|en)/, '');
        return (
          clean.startsWith('/dashboard/photographer/events') &&
          !clean.startsWith('/dashboard/photographer/events/new')
        );
      },
    },
    {
      href: '/dashboard/photographer/events/new',
      label: navLabels.createEvent,
      icon: CalendarPlus,
      isActive: (p: string) => {
        const clean = p.replace(/^\/(es|en)/, '');
        return clean === '/dashboard/photographer/events/new';
      },
    },
    {
      // Single combined Sales + Earnings entry. The destination page renders
      // both as tabs; legacy `/ventas` and `/ganancias` redirect here.
      href: '/dashboard/photographer/sales',
      label: navLabels.sales,
      icon: TrendingUp,
      isActive: (p: string) => {
        const clean = p.replace(/^\/(es|en)/, '');
        return (
          clean.startsWith('/dashboard/photographer/sales') ||
          clean.startsWith('/dashboard/photographer/ventas') ||
          clean.startsWith('/dashboard/photographer/ganancias') ||
          clean.startsWith('/dashboard/photographer/earnings')
        );
      },
    },
  ];

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden border-t bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
    >
      {navLinks.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.href}
            href={lp(item.href)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1.5 min-h-16 py-2 transition-colors duration-150',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/70',
            )}
          >
            <item.icon
              className={cn(
                'h-5 w-5 shrink-0 transition-all duration-150',
                active ? 'stroke-[2.5]' : 'stroke-[1.5]',
              )}
              aria-hidden="true"
            />
            <span
              className={cn('text-[11px] leading-none tracking-tight', active && 'font-semibold')}
            >
              {item.label}
            </span>
          </Link>
        );
      })}

      {/* Account tab — avatar trigger + account dropdown, shared with talent. */}
      <BottomNavAccount
        user={user}
        activeRole={activeRole}
        labels={{
          accountTab: navLabels.account,
          activeRoleLabel: navLabels.activeRoleLabel,
          currentRoleName: navLabels.roleLabel,
          switchRoleLabel: navLabels.switchToTalent,
          profile: navLabels.profile,
          settings: navLabels.settings,
          support: navLabels.support,
          feedback: navLabels.feedback,
          logOut: navLabels.logOut,
        }}
      />
    </nav>
  );
}
