import { ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { getCartItemCountAction } from '@/app/[lang]/dashboard/talent/cart/actions';
import { DashboardUserMenu } from '@/components/dashboard-user-menu';
import { Button } from '@/components/ui/button';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';
import { localizedPath } from '@/lib/i18n/localized-path';
import type { RoleSlug } from '@/lib/roles';
import { cn } from '@/lib/utils';

export async function DashboardTopHeader({
  user,
  activeRole,
  heldRoles = [],
}: {
  user: {
    name: string;
    email: string;
    avatar?: string | null;
  };
  activeRole: RoleSlug;
  /** Roles the user holds — decides whether the account menu offers a role
   *  switch or an upgrade (T-234). */
  heldRoles?: RoleSlug[];
}) {
  const lang = await getLangFromHeaders();
  const dict = await getDictionary(lang as Locale);
  // Only show cart for talent users
  const cartItemCount = activeRole === 'talent' ? await getCartItemCountAction() : 0;

  return (
    <div className="pointer-events-none absolute top-4 right-4 z-40 hidden md:flex md:items-center md:gap-3">
      {activeRole === 'talent' && (
        <Link href={localizedPath(lang, '/dashboard/talent/cart')} className="pointer-events-auto">
          <Button
            variant="ghost"
            size="sm"
            className="relative h-9 w-9 rounded-lg hover:bg-accent p-0"
            aria-label="Shopping cart"
          >
            <ShoppingCart className="h-5 w-5" />
            {cartItemCount > 0 && (
              <span
                className={cn(
                  'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold',
                  'bg-primary text-primary-foreground',
                )}
              >
                {cartItemCount > 99 ? '99+' : cartItemCount}
              </span>
            )}
          </Button>
        </Link>
      )}
      <div className="pointer-events-auto">
        <DashboardUserMenu
          user={user}
          activeRole={activeRole}
          heldRoles={heldRoles}
          navLabels={{
            activeRole: dict.dashboard.activeRole,
            profile: dict.dashboard.profile,
            settings: dict.dashboard.settings,
            support: dict.dashboard.support,
            feedback: dict.dashboard.feedback,
            switchTo: dict.dashboard.switchTo,
            becomePhotographer: dict.dashboard.becomePhotographer,
            becomeTalent: dict.dashboard.becomeTalent,
            roleActionFailed: dict.dashboard.roleActionFailed,
            roleActionNotSignedIn: dict.dashboard.roleActionNotSignedIn,
            logOut: dict.dashboard.logOut,
            rolePhotographer: dict.photographerDashboard.rolePhotographer,
            roleTalent: dict.talentDashboard.talentRole,
          }}
        />
      </div>
    </div>
  );
}
