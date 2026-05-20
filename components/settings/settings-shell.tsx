'use client';

import { CreditCard, Globe, Landmark, type LucideIcon, User, UserCog } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

/**
 * Settings layout: a single horizontal tab bar above the section content.
 * Navigation is route-based (each section is its own page), so the tabs are
 * `Link`s rendered through `TabsTrigger asChild`; `Tabs` `value` is driven by
 * the current pathname. The tab row scrolls horizontally (scrollbar hidden)
 * when it overflows on small screens rather than wrapping to two lines.
 */
export function SettingsShell({ sections, children }: Props) {
  const pathname = usePathname();
  const activeSlug = sections.find((s) => pathname === s.href)?.slug ?? sections[0]?.slug;

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <Tabs value={activeSlug}>
        {/* `-mx-4 px-4` lets the scroll area bleed to the screen edges on
            mobile so the first/last tab align with the page padding. */}
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
          <TabsList className="w-max">
            {sections.map((s) => {
              const Icon = SLUG_TO_ICON[s.slug];
              return (
                <TabsTrigger key={s.slug} value={s.slug} asChild>
                  <Link href={s.href} aria-current={pathname === s.href ? 'page' : undefined}>
                    <Icon className="h-4 w-4 shrink-0" />
                    {s.label}
                  </Link>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
      </Tabs>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
