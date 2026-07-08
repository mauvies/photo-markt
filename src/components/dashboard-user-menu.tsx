'use client';

import { Camera, LifeBuoy, LogOut, Send, Settings, Shield, User } from 'lucide-react';
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
 * pointer cursor — keeps the menu reliable on touch laptops/tablets too.
 */
const MENU_ITEM_CLASS = 'cursor-pointer py-2 text-[15px]';

export function DashboardUserMenu({
  user,
  activeRole,
  navLabels = {},
}: {
  user: {
    name: string;
    email: string;
    avatar?: string | null;
  };
  activeRole: RoleSlug;
  navLabels?: {
    activeRole?: string;
    profile?: string;
    /** Talent-only — rendered as a dropdown item under the support group.
     *  Photographer menus hide the item entirely (the privacy page is
     *  talent-facing). */
    privacy?: string;
    settings?: string;
    support?: string;
    feedback?: string;
    switchTo?: string;
    logOut?: string;
    rolePhotographer?: string;
    roleTalent?: string;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [optimisticRole, addOptimisticRole] = useOptimistic<RoleSlug, RoleSlug>(
    activeRole,
    (_, role) => role,
  );
  const [isPending, startTransition] = useTransition();

  const handleLogout = async () => {
    // Browser-side signOut clears auth cookies synchronously in the current
    // document. The fetch fallback is kept for defense-in-depth so the server
    // also drops the session, but the order matters — clear locally first so
    // proxy.ts on the next nav can't re-establish the session via getUser().
    const supabase = createClient();
    await supabase.auth.signOut();
    try {
      await fetch('/auth/signout', { method: 'POST' });
    } catch {
      // Non-fatal — browser-side signOut already cleared the session.
    }
    router.push('/');
    router.refresh();
  };

  const handleSwitchRole = (role: RoleSlug) => {
    if (role === optimisticRole || isPending) return;
    startTransition(async () => {
      addOptimisticRole(role);
      try {
        const result = await switchRole(role);
        addOptimisticRole(result.activeRole);
        router.push(role === 'photographer' ? '/dashboard/photographer' : '/dashboard/talent');
      } catch {
        addOptimisticRole(activeRole);
      }
    });
  };

  // Photographer "Profile" → dashboard-wrapped preview so the dashboard
  // sidebar/header stay visible. The public profile URL is reserved for
  // sharing externally (via the "Copy profile link" button on the page).
  const profileUrl =
    optimisticRole === 'photographer'
      ? '/dashboard/photographer/profile/preview'
      : '/dashboard/talent/profile';
  const settingsUrl =
    optimisticRole === 'photographer'
      ? '/dashboard/photographer/settings'
      : '/dashboard/talent/settings';

  const isProfileActive = pathname.startsWith(profileUrl);
  const isSettingsActive = pathname.startsWith(settingsUrl);

  const otherRole: RoleSlug = optimisticRole === 'photographer' ? 'talent' : 'photographer';
  const photographerLabel = navLabels.rolePhotographer ?? 'Photographer';
  const talentLabel = navLabels.roleTalent ?? 'Talent';
  const otherRoleLabel = otherRole === 'photographer' ? photographerLabel : talentLabel;
  const currentRoleLabel = optimisticRole === 'photographer' ? photographerLabel : talentLabel;

  return (
    <DropdownMenu>
      {/* Circular trigger: the hover affordance is a ring that traces the
          avatar's circle exactly — no background tint that would darken the
          user's photo or bleed past it as a rounded square. */}
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User menu"
          className="rounded-full ring-offset-background transition-shadow hover:ring-2 hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Avatar className="h-10 w-10">
            <AvatarImage src={user.avatar ?? undefined} alt={user.name} />
            <AvatarFallback>{user.name?.charAt(0).toUpperCase() ?? 'U'}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      {/* `collisionPadding` keeps the menu off the viewport edge on mobile. */}
      <DropdownMenuContent
        className="w-56 rounded-lg"
        side="bottom"
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
          {optimisticRole === 'photographer' ? (
            <Camera className="mr-2 h-4 w-4" />
          ) : (
            <User className="mr-2 h-4 w-4" />
          )}
          <span>
            {navLabels.activeRole ?? 'Role'}:{' '}
            <span className="font-medium text-foreground">{currentRoleLabel}</span>
          </span>
        </div>

        {/* Role switch — surfaced near the role indicator so the user can
            toggle without scanning the full menu. */}
        <DropdownMenuItem
          onClick={() => handleSwitchRole(otherRole)}
          disabled={isPending}
          className={MENU_ITEM_CLASS}
        >
          {otherRole === 'photographer' ? (
            <Camera className="mr-2 h-4 w-4" />
          ) : (
            <User className="mr-2 h-4 w-4" />
          )}
          <span>
            {navLabels.switchTo ?? 'Switch to'} {otherRoleLabel}
          </span>
        </DropdownMenuItem>

        {/* Profile + Settings — surfaced in the dropdown on every role/viewport
            (the photographer sidebar links them too; having them here as well
            is intentional). Payouts/Billing are not — they live inside
            Settings. */}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className={cn(MENU_ITEM_CLASS, isProfileActive && 'bg-accent')}>
            <Link href={profileUrl}>
              <User className="mr-2 h-4 w-4" />
              <span>{navLabels.profile ?? 'Profile'}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            asChild
            className={cn(MENU_ITEM_CLASS, isSettingsActive && 'bg-accent')}
          >
            <Link href={settingsUrl}>
              <Settings className="mr-2 h-4 w-4" />
              <span>{navLabels.settings ?? 'Settings'}</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
            <Link href={`/dashboard/${optimisticRole}/support`}>
              <LifeBuoy className="mr-2 h-4 w-4" />
              <span>{navLabels.support ?? 'Support'}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
            <Link href={`/dashboard/${optimisticRole}/feedback`}>
              <Send className="mr-2 h-4 w-4" />
              <span>{navLabels.feedback ?? 'Feedback'}</span>
            </Link>
          </DropdownMenuItem>
          {/* Privacy disclosure — talent-only. Lives here rather than in
              the top nav so it doesn't compete with primary destinations. */}
          {optimisticRole === 'talent' && navLabels.privacy ? (
            <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
              <Link href="/dashboard/talent/privacy">
                <Shield className="mr-2 h-4 w-4" />
                <span>{navLabels.privacy}</span>
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className={MENU_ITEM_CLASS}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{navLabels.logOut ?? 'Log out'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
