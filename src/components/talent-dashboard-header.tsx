'use client';

import { Heart, Search, ShoppingBag, ShoppingCart, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BottomNav } from '@/components/bottom-nav';
import { BottomNavAccount } from '@/components/bottom-nav-account';
import { CartLinkButton } from '@/components/cart-link-button';
import { DashboardUserMenu } from '@/components/dashboard-user-menu';
import { HeaderShell } from '@/components/header-shell';
import { LogoLink } from '@/components/logo-link';
import { useCartItemCount } from '@/hooks/use-cart-item-count';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { dashboardHomeForRole } from '@/lib/auth/dashboard-home';
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
    { href: '/dashboard/talent/favorites', label: navLabels.myPhotos, icon: Heart },
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
      <HeaderShell className="hidden md:block">
        {/* Left: Logo */}
        <LogoLink
          href={lp(dashboardHomeForRole(activeRole))}
          className="flex shrink-0 items-center gap-2"
          imgClassName="mt-1 h-10 w-auto"
          priority
        />

        {/* Center: Nav Links (desktop only) */}
        <nav className="hidden md:flex items-center gap-0.5">
          {talentNavLinks.map((link) => (
            <Link
              key={link.href}
              href={lp(link.href)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-colors',
                isActive(link.href)
                  ? 'bg-accent/95 text-foreground hover:bg-accent/90'
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
      </HeaderShell>

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
