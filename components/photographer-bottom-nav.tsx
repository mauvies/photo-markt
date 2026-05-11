'use client';

import {
  CalendarDays,
  CalendarPlus,
  Camera,
  CreditCard,
  Home,
  LifeBuoy,
  LogOut,
  Send,
  Settings,
  TrendingUp,
  User,
  WalletMinimal,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';
import { switchRole } from '@/app/[lang]/actions/roles';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createClient } from '@/database/client';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { RoleSlug } from '@/lib/roles';
import { cn } from '@/lib/utils';

const accountActiveRoutes = ['/dashboard/photographer/profile', '/dashboard/photographer/settings'];

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
    revenue: string;
    account: string;
    roleLabel: string;
    profile: string;
    settings: string;
    billing: string;
    payouts: string;
    support: string;
    feedback: string;
    switchToTalent: string;
    logOut: string;
  };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const lp = useLocalizedPath();
  const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';

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
      label: navLabels.revenue,
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
  const [_optimisticRole, addOptimisticRole] = useOptimistic<RoleSlug, RoleSlug>(
    activeRole,
    (_, role) => role,
  );
  const [isPending, startTransition] = useTransition();

  const handleLogout = async () => {
    // Use the browser Supabase client directly so cookies are cleared in the
    // current document synchronously. The previous `fetch('/auth/signout')`
    // approach relied on Set-Cookie headers propagating from the response —
    // fragile on mobile Safari (ITP) and racy with the subsequent navigation,
    // which let `proxy.ts` re-establish the session via getUser() before the
    // browser had applied the deletion headers.
    const supabase = createClient();
    await supabase.auth.signOut();
    // Mirror the server signout too: belt-and-suspenders in case any cookies
    // were set by the browser client without a paired browser-side delete.
    try {
      await fetch('/auth/signout', { method: 'POST' });
    } catch {
      // Non-fatal — browser-side signOut already cleared the session.
    }
    router.push(lp('/'));
    router.refresh();
  };

  const handleSwitchRole = () => {
    if (isPending) return;
    startTransition(async () => {
      addOptimisticRole('talent');
      try {
        const result = await switchRole('talent');
        addOptimisticRole(result.activeRole);
        router.push(lp('/dashboard/talent'));
      } catch {
        addOptimisticRole(activeRole);
      }
    });
  };

  const isAccountActive = accountActiveRoutes.some((r) => pathWithoutLang.startsWith(r));

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
              'flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors duration-150',
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
              className={cn('text-[10px] leading-none tracking-tight', active && 'font-semibold')}
            >
              {item.label}
            </span>
          </Link>
        );
      })}

      {/* Account tab */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors duration-150 outline-none',
            isAccountActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/70',
          )}
          aria-label="Account menu"
        >
          <Avatar
            className={cn(
              'h-5 w-5 transition-all duration-150',
              isAccountActive ? 'ring-[2px] ring-foreground ring-offset-1' : '',
            )}
          >
            <AvatarImage src={user.avatar ?? undefined} alt={user.name} />
            <AvatarFallback className="text-[9px]">
              {user.name?.charAt(0).toUpperCase() ?? 'U'}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              'text-[10px] leading-none tracking-tight',
              isAccountActive && 'font-semibold',
            )}
          >
            {navLabels.account}
          </span>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-56 rounded-lg mb-1" side="top" align="end" sideOffset={8}>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.avatar ?? undefined} alt={user.name} />
                <AvatarFallback>{user.name?.charAt(0).toUpperCase() ?? 'U'}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
            </div>
          </DropdownMenuLabel>

          <div className="px-2 py-1.5">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Camera className="h-3 w-3" />
              {navLabels.roleLabel}
            </span>
          </div>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              {/* "Profile" goes to the dashboard-wrapped preview so the
                  photographer stays inside the dashboard chrome while
                  viewing their own profile. The public URL is exposed
                  separately via the "Copy profile link" button. */}
              <Link href={lp('/dashboard/photographer/profile/preview')}>
                <User className="mr-2 h-4 w-4" />
                <span>{navLabels.profile}</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={lp('/dashboard/photographer/settings/payout-profile')}>
                <WalletMinimal className="mr-2 h-4 w-4" />
                <span>{navLabels.payouts}</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={lp('/dashboard/photographer/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                <span>{navLabels.settings}</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={lp('/dashboard/photographer/settings?tab=billing')}>
                <CreditCard className="mr-2 h-4 w-4" />
                <span>{navLabels.billing}</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={lp('/dashboard/photographer/support')}>
                <LifeBuoy className="mr-2 h-4 w-4" />
                <span>{navLabels.support}</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={lp('/dashboard/photographer/feedback')}>
                <Send className="mr-2 h-4 w-4" />
                <span>{navLabels.feedback}</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={handleSwitchRole} disabled={isPending}>
              <Camera className="mr-2 h-4 w-4" />
              <span>{navLabels.switchToTalent}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>{navLabels.logOut}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
