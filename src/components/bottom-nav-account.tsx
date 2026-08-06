'use client';

import { Camera, LifeBuoy, LogOut, Send, Settings, Shield, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  enablePhotographerRole,
  enableTalentRole,
  type RoleActionResult,
  switchRole,
} from '@/app/[lang]/actions/roles';
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
import { roleActionErrorLabel } from '@/lib/role-action-error';
import type { RoleSlug } from '@/lib/roles';
import { cn } from '@/lib/utils';

/**
 * Shared sizing for every account-dropdown row: slightly taller and a slightly
 * larger font than the Shadcn default for easier tapping. Applied to the
 * interactive items AND the informational role row so every row lines up.
 *
 * `cursor-pointer` is deliberate: Shadcn's DropdownMenuItem ships `cursor-default`,
 * and iOS Safari only fires a synthetic `click` on elements it treats as
 * interactive. The `asChild` link items are fine (an <a> qualifies), but the
 * plain-<div> items (log out, role switch) never received the tap without a
 * pointer cursor — that was the "logout does nothing on mobile" bug.
 */
const MENU_ITEM_CLASS = 'cursor-pointer py-2 text-[15px]';

export interface BottomNavAccountLabels {
  /** Label rendered under the avatar in the nav bar. */
  accountTab: string;
  /** "Role" — prefixes the active-role indicator row. */
  activeRoleLabel: string;
  /** Localized name of the CURRENT role (e.g. "Photographer"). */
  currentRoleName: string;
  /** Full localized "Switch to <other role>" string. */
  switchRoleLabel: string;
  /** Full localized "Become a <other role>" string — shown instead of
   *  `switchRoleLabel` when the user doesn't hold that role yet (T-234). */
  becomeRoleLabel?: string;
  roleActionFailed?: string;
  roleActionNotSignedIn?: string;
  profile: string;
  settings: string;
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
  heldRoles = [],
  labels,
}: {
  user: { name: string; email: string; avatar?: string | null };
  activeRole: RoleSlug;
  /** Roles the user holds (capability), not the one they're viewing. See the
   *  same prop on `DashboardUserMenu` for why the menu needs it. */
  heldRoles?: RoleSlug[];
  labels: BottomNavAccountLabels;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const lp = useLocalizedPath();
  const [isPending, startTransition] = useTransition();

  const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';
  const isPhotographer = activeRole === 'photographer';
  const otherRole: RoleSlug = isPhotographer ? 'talent' : 'photographer';
  // "Switch to X" promises a role the user already has; offering it to someone
  // who doesn't hold X is a promise the server has to break (T-234).
  const holdsOtherRole = heldRoles.includes(otherRole);
  const roleSwitchLabel = holdsOtherRole
    ? labels.switchRoleLabel
    : (labels.becomeRoleLabel ?? labels.switchRoleLabel);

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
      // Holding the role → switch. Not holding it → grant it first; that is a
      // different action on purpose (see `enablePhotographerRole`).
      const run = holdsOtherRole
        ? () => switchRole(otherRole)
        : otherRole === 'photographer'
          ? enablePhotographerRole
          : enableTalentRole;
      let result: RoleActionResult;
      try {
        result = await run();
      } catch (err) {
        console.error('[BottomNavAccount] role action threw', err);
        result = { ok: false, error: 'failed' };
      }
      if (!result.ok) {
        // T-234: the old `catch {}` here left the user staring at an unchanged
        // menu with no idea the server had refused.
        toast.error(roleActionErrorLabel(result.error, labels));
        return;
      }
      router.push(lp(`/dashboard/${otherRole}`));
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

      {/* `collisionPadding` keeps the menu off the viewport edge on mobile. */}
      <DropdownMenuContent
        className="w-56 rounded-lg mb-1"
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
      >
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

        {/* Active role indicator — informational, non-interactive. Mirrors the
            icon size, gap and padding of the menu items so it lines up. */}
        <div className={cn('flex items-center gap-2 px-2 text-muted-foreground', MENU_ITEM_CLASS)}>
          {isPhotographer ? <Camera className="mr-2 h-4 w-4" /> : <User className="mr-2 h-4 w-4" />}
          <span>
            {labels.activeRoleLabel}:{' '}
            <span className="font-medium text-foreground">{labels.currentRoleName}</span>
          </span>
        </div>

        {/* Role switch — surfaced near the role indicator so the user can
            toggle without scanning the full menu. */}
        <DropdownMenuItem
          onClick={handleSwitchRole}
          disabled={isPending}
          className={MENU_ITEM_CLASS}
        >
          {otherRole === 'photographer' ? (
            <Camera className="mr-2 h-4 w-4" />
          ) : (
            <User className="mr-2 h-4 w-4" />
          )}
          <span>{roleSwitchLabel}</span>
        </DropdownMenuItem>

        {/* Profile + Settings — always surfaced. On mobile the bottom nav only
            holds the primary work links, so this is their access point;
            Payouts/Billing live inside Settings. */}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
            <Link href={lp(profileHref)}>
              <User className="mr-2 h-4 w-4" />
              <span>{labels.profile}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
            <Link href={lp(settingsHref)}>
              <Settings className="mr-2 h-4 w-4" />
              <span>{labels.settings}</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
            <Link href={lp(`/dashboard/${activeRole}/support`)}>
              <LifeBuoy className="mr-2 h-4 w-4" />
              <span>{labels.support}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
            <Link href={lp(`/dashboard/${activeRole}/feedback`)}>
              <Send className="mr-2 h-4 w-4" />
              <span>{labels.feedback}</span>
            </Link>
          </DropdownMenuItem>
          {!isPhotographer && labels.privacy ? (
            <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
              <Link href={lp('/dashboard/talent/privacy')}>
                <Shield className="mr-2 h-4 w-4" />
                <span>{labels.privacy}</span>
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className={MENU_ITEM_CLASS}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{labels.logOut}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
