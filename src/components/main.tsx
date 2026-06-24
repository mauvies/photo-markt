'use client';

import { usePathname } from 'next/navigation';

export function Main({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuth =
    pathname?.includes('/signup') ||
    pathname?.includes('/login') ||
    pathname?.includes('/auth/reset-password');
  const isDashboard = pathname?.includes('/dashboard');

  // `w-full` (100%), never `w-screen` (100vw): 100vw ignores the vertical
  // scrollbar, so on a scrolling page it overflows the content box by the
  // scrollbar width. That stray horizontal overflow makes mobile browsers
  // render the page slightly zoomed-in on load, which in turn pushes the
  // fixed bottom nav and the sticky selection toolbar out of position until
  // you pinch-zoom back to 1:1. 100% respects the scrollbar and never
  // overflows. (T-043)
  return <main className={isAuth || isDashboard ? 'w-full h-dvh' : 'w-full'}>{children}</main>;
}
