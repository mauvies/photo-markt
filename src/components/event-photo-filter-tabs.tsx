'use client';

import { cn } from '@/lib/utils';

export type EventPhotoFilter = 'all' | 'mine';

interface EventPhotoFilterTabsProps {
  value: EventPhotoFilter;
  onValueChange: (value: EventPhotoFilter) => void;
  allLabel: string;
  mineLabel: string;
  /** Optional per-tab photo counts, appended as "label (N)" when provided
   * (T-104). `allCount` is the event total; `mineCount` the viewer's uploads. */
  allCount?: number;
  mineCount?: number;
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
  allCount,
  mineCount,
}: EventPhotoFilterTabsProps) {
  const withCount = (label: string, count: number | undefined) =>
    typeof count === 'number' ? `${label} (${count})` : label;
  const tabs: Array<{ key: EventPhotoFilter; label: string }> = [
    { key: 'all', label: withCount(allLabel, allCount) },
    { key: 'mine', label: withCount(mineLabel, mineCount) },
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
