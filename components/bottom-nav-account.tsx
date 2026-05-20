'use client';

import {
  Camera,
  CreditCard,
  LifeBuoy,
  LogOut,
  Send,
  Settings,
  Shield,
  User,
  WalletMinimal,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
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

export interface BottomNavAccountLabels {
  /** Label rendered under the avatar in the nav bar. */
  accountTab: string;
  /** "Role" — prefixes the active-role indicator row. */
  activeRoleLabel: string;
  /** Localized name of the CURRENT role (e.g. "Photographer"). */
  currentRoleName: string;
  /** Full localized "Switch to <other role>" string. */
  switchRoleLabel: string;
  profile: string;
  settings: string;
  /** Photographer-only menu items. */
  billing?: string;
  payouts?: string;
  /** Talent-only menu item. */
  privacy?: string;
  support: string;
  feedback: string;
  logOut: string;
}

/**
 * Rightmost slot of the mobile bottom navigation: the user's avatar, which
 * opens the account dropdown. Shared by both the photographer and talent
 * bottom navs — the menu contents adapt to `activeRole` (the same role
 * branching `DashboardUserMenu` uses for the desktop header dropdown).
 */
export function BottomNavAccount({
  user,
  activeRole,
  labels,
}: {
  user: { name: string; email: string; avatar?: string | null };
  activeRole: RoleSlug;
  labels: BottomNavAccountLabels;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const lp = useLocalizedPath();
  const [isPending, startTransition] = useTransition();

  const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';
  const isPhotographer = activeRole === 'photographer';
  const otherRole: RoleSlug = isPhotographer ? 'talent' : 'photographer';

  // Photographer "Profile" → the dashboard-wrapped preview so the dashboard
  // chrome stays visible; talent goes straight to their profile page.
  const profileHref = isPhotographer
    ? '/dashboard/photographer/profile/preview'
    : '/dashboard/talent/profile';
  const settingsHref = `/dashboard/${activeRole}/settings`;

  const accountActiveRoutes = [
    `/dashboard/${activeRole}/profile`,
    `/dashboard/${activeRole}/settings`,
  ];
  const isAccountActive = accountActiveRoutes.some((r) => pathWithoutLang.startsWith(r));

  const handleLogout = async () => {
    // Browser-side signOut clears auth cookies synchronously before the
    // navigation so proxy.ts can't re-establish the session via getUser().
    const supabase = createClient();
    await supabase.auth.signOut();
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
      try {
        await switchRole(otherRole);
        router.push(lp(`/dashboard/${otherRole}`));
      } catch {
        // Stay on the current role — the server action rejected the switch.
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex flex-1 flex-col items-center justify-center gap-1.5 min-h-16 py-2 transition-colors duration-150 outline-none',
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
            'text-[11px] leading-none tracking-tight',
            isAccountActive && 'font-semibold',
          )}
        >
          {labels.accountTab}
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
              <span className="truncate text-sm text-muted-foreground md:text-xs">
                {user.email}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>

        <div className="px-2 py-1.5">
          <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground md:text-xs">
            {isPhotographer ? (
              <Camera className="h-3.5 w-3.5 md:h-3 md:w-3" />
            ) : (
              <User className="h-3.5 w-3.5 md:h-3 md:w-3" />
            )}
            {labels.activeRoleLabel}:
            <span className="font-medium text-foreground">{labels.currentRoleName}</span>
          </span>
        </div>

        {/* Role switch — surfaced near the role indicator so the user can
            toggle without scanning the full menu. */}
        <DropdownMenuItem onClick={handleSwitchRole} disabled={isPending}>
          {otherRole === 'photographer' ? (
            <Camera className="mr-2 h-4 w-4" />
          ) : (
            <User className="mr-2 h-4 w-4" />
          )}
          <span>{labels.switchRoleLabel}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href={lp(profileHref)}>
              <User className="mr-2 h-4 w-4" />
              <span>{labels.profile}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={lp(settingsHref)}>
              <Settings className="mr-2 h-4 w-4" />
              <span>{labels.settings}</span>
            </Link>
          </DropdownMenuItem>
          {isPhotographer && labels.payouts ? (
            <DropdownMenuItem asChild>
              <Link href={lp('/dashboard/photographer/settings/payout-profile')}>
                <WalletMinimal className="mr-2 h-4 w-4" />
                <span>{labels.payouts}</span>
              </Link>
            </DropdownMenuItem>
          ) : null}
          {isPhotographer && labels.billing ? (
            <DropdownMenuItem asChild>
              <Link href={lp('/dashboard/photographer/settings/billing')}>
                <CreditCard className="mr-2 h-4 w-4" />
                <span>{labels.billing}</span>
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href={lp(`/dashboard/${activeRole}/support`)}>
              <LifeBuoy className="mr-2 h-4 w-4" />
              <span>{labels.support}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={lp(`/dashboard/${activeRole}/feedback`)}>
              <Send className="mr-2 h-4 w-4" />
              <span>{labels.feedback}</span>
            </Link>
          </DropdownMenuItem>
          {!isPhotographer && labels.privacy ? (
            <DropdownMenuItem asChild>
              <Link href={lp('/dashboard/talent/privacy')}>
                <Shield className="mr-2 h-4 w-4" />
                <span>{labels.privacy}</span>
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{labels.logOut}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
