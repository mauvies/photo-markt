'use client';

import {
  CalendarDays,
  CalendarPlus,
  Compass,
  Home,
  Images,
  LifeBuoy,
  Package,
  Send,
  TrendingUp,
  User,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { dashboardHomeForRole } from '@/lib/auth/dashboard-home';
import { NavMains } from './nav-main';
import { NavSecondary } from './nav-secondary';
import { Sidebar, SidebarContent, SidebarHeader } from './ui/sidebar';

interface NavLabels {
  overview: string;
  createEvent: string;
  events: string;
  revenue: string;
  myPhotos: string;
  profile: string;
  explore: string;
  orders: string;
  support: string;
  feedback: string;
}

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
  const photographerNav: Array<{ title: string; url: string; icon: typeof Home }> = [
    { title: navLabels.overview, url: '/dashboard/photographer', icon: Home },
    { title: navLabels.createEvent, url: '/dashboard/photographer/events/new', icon: CalendarPlus },
    { title: navLabels.events, url: '/dashboard/photographer/events', icon: CalendarDays },
    { title: navLabels.revenue, url: '/dashboard/photographer/sales', icon: TrendingUp },
    {
      title: navLabels.profile,
      url: '/dashboard/photographer/profile/preview',
      icon: User,
    },
  ];

  const talentNav = [
    { title: navLabels.overview, url: '/dashboard/talent', icon: Home },
    { title: navLabels.myPhotos, url: '/dashboard/talent/favorites', icon: Images },
    { title: navLabels.profile, url: '/dashboard/talent/profile', icon: User },
    { title: navLabels.explore, url: '/dashboard/talent/events', icon: Compass },
    { title: navLabels.orders, url: '/dashboard/talent/orders', icon: Package },
  ];

  const base = activeRole === 'photographer' ? '/dashboard/photographer' : '/dashboard/talent';
  const navSecondaryItems = [
    { title: navLabels.support, url: `${base}/support`, icon: LifeBuoy },
    { title: navLabels.feedback, url: `${base}/feedback`, icon: Send },
  ];

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
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
