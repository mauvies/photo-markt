'use client';

import { cn } from '@/lib/utils';

export type EventPhotoFilter = 'all' | 'mine';

interface EventPhotoFilterTabsProps {
  value: EventPhotoFilter;
  onValueChange: (value: EventPhotoFilter) => void;
  allLabel: string;
  mineLabel: string;
}

/**
 * Underline-style "All photos / My photos" filter for the event photo grids.
 * Shared by the public and talent event-detail viewers so the two stay in
 * sync. Plain-text labels — the active tab is marked by a bottom border in
 * the app's primary colour; switching animates the underline + text colour.
 */
export function EventPhotoFilterTabs({
  value,
  onValueChange,
  allLabel,
  mineLabel,
}: EventPhotoFilterTabsProps) {
  const tabs: Array<{ key: EventPhotoFilter; label: string }> = [
    { key: 'all', label: allLabel },
    { key: 'mine', label: mineLabel },
  ];
  return (
    <div className="flex shrink-0 items-center gap-4">
      {tabs.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(tab.key)}
            className={cn(
              'whitespace-nowrap border-b-2 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
