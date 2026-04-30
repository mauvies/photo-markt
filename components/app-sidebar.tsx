'use client';

import {
  CalendarDays,
  CalendarPlus,
  Compass,
  Home,
  Images,
  LifeBuoy,
  Package,
  Receipt,
  Send,
  TrendingUp,
  User,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { NavMains } from './nav-main';
import { NavSecondary } from './nav-secondary';
import { Sidebar, SidebarContent, SidebarHeader } from './ui/sidebar';

interface NavLabels {
  overview: string;
  createEvent: string;
  events: string;
  ventas: string;
  ganancias: string;
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

  const photographerNav = [
    { title: navLabels.overview, url: '/dashboard/photographer', icon: Home },
    { title: navLabels.createEvent, url: '/dashboard/photographer/events/new', icon: CalendarPlus },
    { title: navLabels.events, url: '/dashboard/photographer/events', icon: CalendarDays },
    { title: navLabels.ventas, url: '/dashboard/photographer/ventas', icon: Receipt },
    { title: navLabels.ganancias, url: '/dashboard/photographer/ganancias', icon: TrendingUp },
  ];

  const talentNav = [
    { title: navLabels.overview, url: '/dashboard/talent', icon: Home },
    { title: navLabels.myPhotos, url: '/dashboard/talent/photos', icon: Images },
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
          <Link href={lp('/')} className="flex items-center gap-1 px-2">
            <Image
              src="/logo.svg"
              alt="Photo Markt"
              className="h-10 w-auto"
              width={80}
              height={80}
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
