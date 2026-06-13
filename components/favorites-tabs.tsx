'use client';

import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

type FavoritesTab = 'photos' | 'events';

/**
 * Underline-style tabs for the Favorites page (Photos | Events). Both panels
 * are server-rendered and passed in as children; this client wrapper toggles
 * which one is shown. Matches the primary-bottom-border style used by
 * EventPhotoFilterTabs so the two stay visually consistent.
 */
export function FavoritesTabs({
  photosLabel,
  eventsLabel,
  photosTab,
  eventsTab,
}: {
  photosLabel: string;
  eventsLabel: string;
  photosTab: ReactNode;
  eventsTab: ReactNode;
}) {
  const [tab, setTab] = useState<FavoritesTab>('photos');
  const tabs: Array<{ key: FavoritesTab; label: string }> = [
    { key: 'photos', label: photosLabel },
    { key: 'events', label: eventsLabel },
  ];

  return (
    <div>
      <div className="mt-4 flex items-center gap-4 border-b">
        {tabs.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(item.key)}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4">{tab === 'photos' ? photosTab : eventsTab}</div>
    </div>
  );
}
