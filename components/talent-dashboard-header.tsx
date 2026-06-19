'use client';

import { Package, Search, ShoppingBag, ShoppingCart, User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BottomNav } from '@/components/bottom-nav';
import { BottomNavAccount } from '@/components/bottom-nav-account';
import { CartLinkButton } from '@/components/cart-link-button';
import { DashboardUserMenu } from '@/components/dashboard-user-menu';
import { useCartItemCount } from '@/hooks/use-cart-item-count';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { RoleSlug } from '@/lib/roles';
import { cn } from '@/lib/utils';

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
    explore: string;
    myPhotos: string;
    orders: string;
    profile: string;
    privacy: string;
    /** Passed to the avatar dropdown only — the talent-side privacy page
     *  is surfaced there instead of in the top nav. The key stays on this
     *  type for ergonomics so the layout can pass it through unchanged. */
    settings: string;
    billing: string;
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
  const pathname = usePathname();
  const lp = useLocalizedPath();
  const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';
  const cartCount = useCartItemCount();

  const talentNavLinks = [
    { href: '/dashboard/talent/events', label: navLabels.explore, icon: Search },
    { href: '/dashboard/talent/favorites', label: navLabels.myPhotos, icon: Package },
    { href: '/dashboard/talent/orders', label: navLabels.orders, icon: ShoppingBag },
    { href: '/dashboard/talent/profile', label: navLabels.profile, icon: User },
    // Privacy lives in the avatar dropdown, not the top nav — it's a
    // reference page that doesn't earn primary-nav real estate.
  ];

  const isActive = (href: string) => pathWithoutLang.startsWith(href);

  return (
    <>
      {/* Mobile drops the header entirely — the cart moves to the bottom nav
          and the account avatar already lives there, so the only loss is the
          logo. Freeing the 4.5rem bar gives mobile content more vertical room. */}
      <header className="sticky top-0 z-50 hidden w-full border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/80 md:block">
        <div className="mx-auto flex h-(--header-height) max-w-screen-2xl items-center justify-between px-4 md:px-6">
          {/* Left: Logo */}
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

          {/* Center: Nav Links (desktop only) */}
          <nav className="hidden md:flex items-center gap-0.5">
            {talentNavLinks.map((link) => (
              <Link
                key={link.href}
                href={lp(link.href)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  isActive(link.href)
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                )}
              >
                <link.icon className="h-4 w-4 shrink-0" />
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right: cart (all viewports) + account avatar. The avatar is
              desktop-only — on mobile the account dropdown lives in the
              bottom nav, so rendering it here too would duplicate it. */}
          <div className="flex items-center gap-5">
            <div className="-ml-2">
              <CartLinkButton />
            </div>
            <div className="hidden md:block">
              <DashboardUserMenu
                user={user}
                activeRole={activeRole}
                navLabels={{
                  activeRole: navLabels.activeRole,
                  profile: navLabels.profile,
                  privacy: navLabels.privacy,
                  settings: navLabels.settings,
                  billing: navLabels.billing,
                  support: navLabels.support,
                  feedback: navLabels.feedback,
                  switchTo: navLabels.switchTo,
                  logOut: navLabels.logOut,
                  rolePhotographer: navLabels.rolePhotographer,
                  roleTalent: navLabels.roleTalent,
                }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Mobile bottom nav: the "Profile" link is dropped here — the profile
          page is reachable from the avatar account dropdown instead. The cart
          (a header icon on desktop) becomes a tab here, with its item-count
          badge, since the header is hidden on mobile. */}
      <BottomNav
        items={[
          ...talentNavLinks
            .filter((item) => item.href !== '/dashboard/talent/profile')
            .map((item) => ({ ...item, href: lp(item.href) })),
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
