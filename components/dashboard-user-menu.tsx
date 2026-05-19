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
import { useOptimistic, useTransition } from 'react';
import { switchRole } from '@/app/[lang]/actions/roles';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
    billing?: string;
    payouts?: string;
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
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 w-10 rounded-lg hover:bg-accent"
          aria-label="User menu"
        >
          <Avatar className="h-10 w-10">
            <AvatarImage src={user.avatar ?? undefined} alt={user.name} />
            <AvatarFallback>{user.name?.charAt(0).toUpperCase() ?? 'U'}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 rounded-lg" side="bottom" align="end" sideOffset={8}>
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

        {/* Active role indicator */}
        <div className="px-2 py-1.5">
          <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground md:text-xs">
            {optimisticRole === 'photographer' ? (
              <Camera className="h-3.5 w-3.5 md:h-3 md:w-3" />
            ) : (
              <User className="h-3.5 w-3.5 md:h-3 md:w-3" />
            )}
            {navLabels.activeRole ?? 'Role'}:
            <span className="font-medium text-foreground">{currentRoleLabel}</span>
          </span>
        </div>

        {/* Role switch — surfaced near the role indicator so the user can
            toggle without scanning the full menu. */}
        <DropdownMenuItem onClick={() => handleSwitchRole(otherRole)} disabled={isPending}>
          {otherRole === 'photographer' ? (
            <Camera className="mr-2 h-4 w-4" />
          ) : (
            <User className="mr-2 h-4 w-4" />
          )}
          <span>
            {navLabels.switchTo ?? 'Switch to'} {otherRoleLabel}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className={isProfileActive ? 'bg-accent' : ''}>
            <Link href={profileUrl}>
              <User className="mr-2 h-4 w-4" />
              <span>{navLabels.profile ?? 'Profile'}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={isSettingsActive ? 'bg-accent' : ''}>
            <Link href={settingsUrl}>
              <Settings className="mr-2 h-4 w-4" />
              <span>{navLabels.settings ?? 'Settings'}</span>
            </Link>
          </DropdownMenuItem>
          {/* Payouts — only relevant for photographer role; links straight to
              the payout-profile config page that lives under settings/. */}
          {optimisticRole === 'photographer' && (
            <DropdownMenuItem asChild>
              <Link href="/dashboard/photographer/settings/payout-profile">
                <WalletMinimal className="mr-2 h-4 w-4" />
                <span>{navLabels.payouts ?? 'Payouts'}</span>
              </Link>
            </DropdownMenuItem>
          )}
          {optimisticRole === 'photographer' && (
            <DropdownMenuItem asChild>
              <Link href="/dashboard/photographer/settings?tab=billing">
                <CreditCard className="mr-2 h-4 w-4" />
                <span>{navLabels.billing ?? 'Billing'}</span>
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/${optimisticRole}/support`}>
              <LifeBuoy className="mr-2 h-4 w-4" />
              <span>{navLabels.support ?? 'Support'}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/${optimisticRole}/feedback`}>
              <Send className="mr-2 h-4 w-4" />
              <span>{navLabels.feedback ?? 'Feedback'}</span>
            </Link>
          </DropdownMenuItem>
          {/* Privacy disclosure — talent-only. Lives here rather than in
              the top nav so it doesn't compete with primary destinations. */}
          {optimisticRole === 'talent' && navLabels.privacy ? (
            <DropdownMenuItem asChild>
              <Link href="/dashboard/talent/privacy">
                <Shield className="mr-2 h-4 w-4" />
                <span>{navLabels.privacy}</span>
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{navLabels.logOut ?? 'Log out'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
