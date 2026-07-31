import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton mirroring the real `EventCard` (T-119 redesign, T-125 cover ratio,
 * T-127 two-line title): rounded-2xl card, `aspect-[4/3]` cover, and an info
 * section reserving the same two-line title height plus the location/date
 * rows and the divided photographer row — so swapping in the real card
 * produces no layout shift (T-128).
 */
export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="p-3">
        <div className="min-h-[3.1rem] space-y-1.5 pt-0.5">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        <Skeleton className="mt-1.5 h-3.5 w-2/3" />
        <Skeleton className="mt-1.5 h-3.5 w-1/3" />
        {/* The real card renders this row (PhotographerRow, event-card.tsx) for
            every event that has a photographer and isn't owned by the viewer —
            i.e. essentially every card on home/explore. Commenting it out made
            the skeleton ~33px shorter than the card replacing it, which is the
            layout shift T-128 removed. */}
        <div className="mt-2.5 flex items-center gap-2 border-t pt-2.5">
          <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      </div>
    </div>
  );
}

/**
 * A grid of `EventCardSkeleton`s matching `EventGrid`'s real card grid
 * (`sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4`). Used by
 * route-level `loading.tsx` files that show a grid before any data has
 * loaded (the in-app search/filter loading state lives in `EventGrid`
 * itself, which renders the same `EventCardSkeleton`).
 */
export function EventGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-5 sm:gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items, count never changes
        <EventCardSkeleton key={i} />
      ))}
    </div>
  );
}
