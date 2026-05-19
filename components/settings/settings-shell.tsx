'use client';

import { CreditCard, Globe, Landmark, type LucideIcon, User, UserCog } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Allowed section slugs across photographer + talent settings. The icon is
 * derived from this slug inside the client component — passing a lucide
 * component reference from a Server Component is forbidden (React Server
 * Components can't serialize React component references).
 */
export type SettingsSectionSlug = 'profile' | 'account' | 'language' | 'billing' | 'payouts';

export interface SettingsSection {
  slug: SettingsSectionSlug;
  label: string;
  href: string;
}

const SLUG_TO_ICON: Record<SettingsSectionSlug, LucideIcon> = {
  profile: User,
  account: UserCog,
  language: Globe,
  billing: CreditCard,
  payouts: Landmark,
};

interface Props {
  sections: SettingsSection[];
  children: ReactNode;
}

export function SettingsShell({ sections, children }: Props) {
  const pathname = usePathname();

  return (
    <div className="flex flex-1 flex-col gap-4">
      <nav className="-mx-4 md:hidden">
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-1">
          {sections.map((s) => {
            const isActive = pathname === s.href;
            return (
              <Link
                key={s.slug}
                href={s.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'border-primary bg-accent font-medium text-foreground'
                    : 'border-input text-muted-foreground hover:bg-accent/50',
                )}
              >
                {(() => {
                  const Icon = SLUG_TO_ICON[s.slug];
                  return <Icon className="h-4 w-4 shrink-0" />;
                })()}
                {s.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="grid flex-1 grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        <aside className="hidden md:block">
          <nav className="sticky top-20 flex flex-col gap-0.5" aria-label="Settings sections">
            {sections.map((s) => {
              const isActive = pathname === s.href;
              return (
                <Link
                  key={s.slug}
                  href={s.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  {(() => {
                    const Icon = SLUG_TO_ICON[s.slug];
                    return <Icon className="h-4 w-4 shrink-0" />;
                  })()}
                  {s.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
