'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Stand-in for the code-split `Calendar` while its chunk loads.
 *
 * ⚠️ Its real job is to EXIST. `Calendar` is loaded with `next/dynamic`, and a
 * dynamic import with no Suspense boundary of its own lets the suspension
 * travel up to the nearest ancestor boundary — which is the route's
 * `loading.tsx`. React then hid the whole page (the open dialog included)
 * behind the HOME PAGE SKELETON for the length of the chunk fetch and restored
 * it a second later: the "modal disappears → home skeleton → modal comes back"
 * flicker. Each render site wraps the calendar in its own `<Suspense>` with
 * this as the fallback, so the placeholder never escapes the card it belongs to.
 *
 * It carries its OWN `--cell-size`: the variable the real calendar lays itself
 * out with is declared on the calendar's own `className`, which a fallback
 * never receives — without a default here the rows collapse to nothing and the
 * card visibly grows when the real calendar lands.
 *
 * Callers pass the height of the calendar they're standing in for; the two
 * sites render at different cell heights. In practice this is rarely seen at
 * all — the chunk is warmed as soon as either surface opens.
 */
export function CalendarFallback({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex flex-col gap-4 p-2 [--cell-size:--spacing(7)]', className)}
      aria-hidden="true"
    >
      {/* Month caption */}
      <Skeleton className="mx-auto h-(--cell-size) w-32 shrink-0" />
      {/* Weekday header + six week rows, stretched to fill the reserved box. */}
      <div className="flex flex-1 flex-col gap-2">
        {Array.from({ length: 7 }).map((_, row) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder, count never changes
            key={row}
            className="flex w-full flex-1 gap-1"
          >
            {Array.from({ length: 7 }).map((_, col) => (
              <Skeleton
                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder, count never changes
                key={col}
                className="h-full min-h-(--cell-size) min-w-(--cell-size) flex-1"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
