'use client';

import { usePathname } from 'next/navigation';

export function Main({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuth =
    pathname?.includes('/signup') ||
    pathname?.includes('/login') ||
    pathname?.includes('/auth/reset-password');
  const isDashboard = pathname?.includes('/dashboard');

  return <main className={isAuth || isDashboard ? 'w-screen h-dvh' : 'w-full'}>{children}</main>;
}
