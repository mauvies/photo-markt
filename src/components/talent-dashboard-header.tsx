'use client';

import { Heart, ShoppingCart } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { BottomNav } from '@/components/bottom-nav';
import { BottomNavAccount } from '@/components/bottom-nav-account';
import { TalentHeaderActions } from '@/components/talent-header-actions';
import { useCartItemCount } from '@/hooks/use-cart-item-count';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { RoleSlug } from '@/lib/roles';

export function TalentDashboardHeader({
  user,
  activeRole,
  navLabels,
}: {
  user: {
    name: string;
    email: string;
    avatar?: string | null;
  };
  activeRole: RoleSlug;
  navLabels: {
    /** T-118: no longer a nav link — the header-actions favorites icon
     *  (desktop) / bottom-nav tab (mobile) label. */
    favorites: string;
    /** T-118: no longer a nav link — lives in the account dropdown. */
    orders: string;
    profile: string;
    privacy: string;
    settings: string;
    support: string;
    feedback: string;
    activeRole: string;
    switchTo: string;
    logOut: string;
    rolePhotographer: string;
    roleTalent: string;
    /** Label under the avatar in the mobile bottom nav. */
    account: string;
    /** Label for the cart tab in the mobile bottom nav. */
    cart: string;
  };
}) {
  const lp = useLocalizedPath();
  const cartCount = useCartItemCount();

  return (
    <>
      {/* Mobile drops the header entirely — the cart moves to the bottom nav
          and the account avatar already lives there, so the only loss is the
          logo. Freeing the 4.5rem bar gives mobile content more vertical room. */}
      <header className="sticky top-0 z-50 hidden w-full border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/80 md:block">
        <div className="mx-auto flex h-(--header-height) max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Left: Logo → the unified home/explore page directly (T-118).
              Links straight to `/` rather than `/dashboard/talent` (which now
              just redirects to `/`) to avoid a double redirect hop. */}
          <Link href={lp('/')} className="flex shrink-0 items-center gap-2">
            <Image
              src="/logo.svg"
              alt="Photo Markt"
              className="mt-1 h-9 w-auto md:h-10"
              width={90}
              height={90}
              priority
            />
          </Link>

          {/* Right: same cart/favorites/avatar-dropdown pattern as the
              unified public Nav's talent branch (T-118) — one header, not
              two hand-synced ones. */}
          <div className="hidden md:block">
            <TalentHeaderActions user={user} activeRole={activeRole} labels={navLabels} />
          </div>
        </div>
      </header>

      {/* Mobile bottom nav: favorites is a tab (its header icon is hidden on
          mobile along with the rest of the header above); orders/profile
          live in the account dropdown only, on both desktop and mobile. */}
      <BottomNav
        items={[
          {
            href: lp('/dashboard/talent/favorites'),
            label: navLabels.favorites,
            icon: Heart,
          },
          {
            href: lp('/dashboard/talent/cart'),
            label: navLabels.cart,
            icon: ShoppingCart,
            badge:
              cartCount > 0 ? (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              ) : undefined,
          },
        ]}
        account={
          <BottomNavAccount
            user={user}
            activeRole={activeRole}
            labels={{
              accountTab: navLabels.account,
              activeRoleLabel: navLabels.activeRole,
              currentRoleName: navLabels.roleTalent,
              switchRoleLabel: `${navLabels.switchTo} ${navLabels.rolePhotographer}`,
              profile: navLabels.profile,
              orders: navLabels.orders,
              settings: navLabels.settings,
              privacy: navLabels.privacy,
              support: navLabels.support,
              feedback: navLabels.feedback,
              logOut: navLabels.logOut,
            }}
          />
        }
      />
    </>
  );
}
