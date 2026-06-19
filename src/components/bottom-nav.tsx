'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface BottomNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Override the default active detection. */
  isActive?: (pathname: string) => boolean;
  /** Optional overlay on the icon — e.g. the cart item-count bubble. The node
   * positions itself (absolute) over the icon. */
  badge?: ReactNode;
}

export function BottomNav({
  items,
  account,
}: {
  items: BottomNavItem[];
  /** Optional rightmost slot — e.g. the avatar account dropdown. */
  account?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden border-t bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
    >
      {items.map((item) => {
        const pathForCheck = pathname.replace(/^\/(es|en)/, '') || '/';
        const hrefForCheck = item.href.replace(/^\/(es|en)/, '') || '/';
        const active = item.isActive
          ? item.isActive(pathForCheck)
          : item.exact
            ? pathForCheck === hrefForCheck
            : pathForCheck.startsWith(hrefForCheck);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1.5 min-h-16 py-2 transition-colors duration-150',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/70',
            )}
          >
            <span className="relative">
              <item.icon
                className={cn(
                  'h-5 w-5 shrink-0 transition-all duration-150',
                  active ? 'stroke-[2.5]' : 'stroke-[1.5]',
                )}
                aria-hidden="true"
              />
              {item.badge}
            </span>
            <span
              className={cn('text-[11px] leading-none tracking-tight', active && 'font-semibold')}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
      {account}
    </nav>
  );
}
