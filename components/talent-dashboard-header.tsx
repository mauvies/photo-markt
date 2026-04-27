'use client';

import { Package, Search, ShoppingBag, User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BottomNav } from '@/components/bottom-nav';
import { CartLinkButton } from '@/components/cart-link-button';
import { DashboardUserMenu } from '@/components/dashboard-user-menu';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { RoleSlug } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from './language-switcher';

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
    settings: string;
    billing: string;
    support: string;
    feedback: string;
    activeRole: string;
    switchTo: string;
    logOut: string;
    rolePhotographer: string;
    roleTalent: string;
  };
}) {
  const pathname = usePathname();
  const lp = useLocalizedPath();
  const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';

  const talentNavLinks = [
    { href: '/dashboard/talent/events', label: navLabels.explore, icon: Search },
    { href: '/dashboard/talent/photos', label: navLabels.myPhotos, icon: Package },
    { href: '/dashboard/talent/orders', label: navLabels.orders, icon: ShoppingBag },
    { href: '/dashboard/talent/profile', label: navLabels.profile, icon: User },
  ];

  const isActive = (href: string) => pathWithoutLang.startsWith(href);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="mx-auto flex h-(--header-height) max-w-screen-2xl items-center justify-between px-4 md:px-6">
          {/* Left: Logo */}
          <Link href={lp('/')} className="flex shrink-0 items-center gap-2">
            <Image
              src="/logo.svg"
              alt="Photo Markt"
              className="h-9 w-auto mt-2 md:h-12"
              width={80}
              height={80}
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

          {/* Right: Cart + User Avatar */}
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <CartLinkButton />
            <DashboardUserMenu
              user={user}
              activeRole={activeRole}
              navLabels={{
                activeRole: navLabels.activeRole,
                profile: navLabels.profile,
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
      </header>

      <BottomNav items={talentNavLinks.map((item) => ({ ...item, href: lp(item.href) }))} />
    </>
  );
}
