'use client';

import {
  CalendarDays,
  CalendarPlus,
  Compass,
  Home,
  Images,
  LifeBuoy,
  type LucideIcon,
  Package,
  Send,
  Settings,
  TrendingUp,
  User,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { dashboardHomeForRole } from '@/lib/auth/dashboard-home';
import {
  buildPhotographerSidebarItems,
  type PhotographerSidebarKey,
  showSidebarSupportFeedback,
} from '@/lib/nav/photographer-nav';
import { NavMains } from './nav-main';
import { NavSecondary } from './nav-secondary';
import { Sidebar, SidebarContent, SidebarHeader } from './ui/sidebar';

interface NavLabels {
  overview: string;
  createEvent: string;
  events: string;
  /** Sales/Ventas — renamed from Earnings/Ganancias (T-075). */
  sales: string;
  settings: string;
  myPhotos: string;
  profile: string;
  explore: string;
  orders: string;
  /** Optional — only the (talent) secondary section renders these. */
  support?: string;
  feedback?: string;
}

/** Maps each photographer sidebar item to its icon (kept out of the pure
 *  composition helper so that stays free of React/icon deps). */
const PHOTOGRAPHER_ICONS: Record<PhotographerSidebarKey, LucideIcon> = {
  overview: Home,
  events: CalendarDays,
  createEvent: CalendarPlus,
  sales: TrendingUp,
  profile: User,
  settings: Settings,
};

export function AppSidebar({
  activeRole,
  navLabels,
  ...props
}: ComponentProps<typeof Sidebar> & {
  activeRole: 'photographer' | 'talent';
  navLabels: NavLabels;
}) {
  const lp = useLocalizedPath();

  // "Profile" for photographers points to the dashboard-wrapped preview
  // (`/dashboard/photographer/profile/preview`) — same UI as the public
  // page but with the dashboard sidebar/header still visible. The public
  // URL (`/photographer/{slug}`) is reserved for sharing externally; it's
  // exposed via the "Copy profile link" button on the profile itself.
  // Order + membership (6 items incl. Settings) live in the pure helper.
  const photographerNav = buildPhotographerSidebarItems({
    overview: navLabels.overview,
    events: navLabels.events,
    createEvent: navLabels.createEvent,
    sales: navLabels.sales,
    profile: navLabels.profile,
    settings: navLabels.settings,
  }).map((item) => ({ title: item.title, url: item.url, icon: PHOTOGRAPHER_ICONS[item.key] }));

  const talentNav = [
    { title: navLabels.overview, url: '/dashboard/talent', icon: Home },
    { title: navLabels.myPhotos, url: '/dashboard/talent/favorites', icon: Images },
    { title: navLabels.profile, url: '/dashboard/talent/profile', icon: User },
    { title: navLabels.explore, url: '/dashboard/talent/events', icon: Compass },
    { title: navLabels.orders, url: '/dashboard/talent/orders', icon: Package },
  ];

  const base = activeRole === 'photographer' ? '/dashboard/photographer' : '/dashboard/talent';
  // Support & Feedback moved to the avatar dropdown for photographers (T-075);
  // the secondary section only renders for roles that keep it in the sidebar.
  const showSecondary =
    showSidebarSupportFeedback(activeRole) && navLabels.support && navLabels.feedback;
  const navSecondaryItems = showSecondary
    ? [
        { title: navLabels.support as string, url: `${base}/support`, icon: LifeBuoy },
        { title: navLabels.feedback as string, url: `${base}/feedback`, icon: Send },
      ]
    : [];

  const navItems = (activeRole === 'photographer' ? photographerNav : talentNav).map((item) => ({
    ...item,
    url: lp(item.url),
  }));
  const navSecondary = navSecondaryItems.map((item) => ({ ...item, url: lp(item.url) }));

  return (
    <Sidebar collapsible="icon" className="h-svh" {...props}>
      <SidebarHeader>
        <div className="relative flex items-center py-1">
          <Link
            href={lp(dashboardHomeForRole(activeRole))}
            className="flex items-center gap-1 px-2"
          >
            <Image
              src="/logo.svg"
              alt="Photo Markt"
              className="h-10 w-auto"
              width={80}
              height={80}
              priority
            />
          </Link>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMains items={navItems} />
        {navSecondary.length > 0 ? <NavSecondary items={navSecondary} className="mt-auto" /> : null}
      </SidebarContent>
    </Sidebar>
  );
}
