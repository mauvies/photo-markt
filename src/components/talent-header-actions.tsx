'use client';

import { CartLinkButton } from '@/components/cart-link-button';
import { DashboardUserMenu } from '@/components/dashboard-user-menu';
import { FavoritesLinkButton } from '@/components/favorites-link-button';
import type { RoleSlug } from '@/lib/roles';

export interface TalentHeaderActionsLabels {
  /** Accessible label for the favorites icon. */
  favorites: string;
  activeRole?: string;
  profile?: string;
  orders?: string;
  privacy?: string;
  settings?: string;
  support?: string;
  feedback?: string;
  switchTo?: string;
  logOut?: string;
  rolePhotographer?: string;
  roleTalent?: string;
}

/**
 * Shared header-actions pattern for an authenticated talent (T-118):
 * `[cart if non-empty] [favorites] [avatar dropdown]` — used by both `Nav`'s
 * talent branch (at `/`) and `TalentDashboardHeader` (within
 * `/dashboard/talent/*`), so an authenticated talent sees one consistent
 * header wherever they browse, instead of two hand-synced ones.
 *
 * `CartLinkButton` reserves its own `h-10 w-10` slot and renders nothing
 * inside it when the cart is empty — no extra gating needed here.
 */
export function TalentHeaderActions({
  user,
  activeRole,
  labels,
}: {
  user: { name: string; email: string; avatar?: string | null };
  activeRole: RoleSlug;
  labels: TalentHeaderActionsLabels;
}) {
  return (
    <div className="flex items-center gap-2 md:gap-5">
      <CartLinkButton />
      <FavoritesLinkButton label={labels.favorites} />
      <DashboardUserMenu user={user} activeRole={activeRole} navLabels={labels} />
    </div>
  );
}
