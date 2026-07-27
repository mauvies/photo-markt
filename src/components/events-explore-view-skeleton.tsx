import { EventGridSkeleton } from '@/components/event-card-skeleton';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton mirroring `EventsExploreView`'s full shell (T-156, follow-up of
 * T-128 which only synced the card grid): hero (title + subtitle), search
 * bar, the "Latest events" heading, and the card grid — so the home page and
 * talent explore page don't jump when the real content hydrates.
 *
 * Shared by both `loading.tsx` routes the same way `EventsExploreView` itself
 * is shared by the two real pages; callers own their own outer page margins.
 */
export function EventsExploreViewSkeleton() {
  return (
    <div className="flex flex-col gap-12">
      <div>
        {/* Hero — title + subtitle */}
        <div className="flex flex-col items-center gap-3 py-4 sm:pt-0">
          <Skeleton className="h-9 w-2/3 max-w-2xl sm:h-12" />
          <Skeleton className="h-5 w-1/2 max-w-xl sm:h-6" />
        </div>
        {/* Search bar */}
        <div className="flex justify-center">
          <Skeleton className="h-14 w-full max-w-[576px] rounded-full" />
        </div>
      </div>
      <div className="space-y-4">
        {/* "Latest events" heading */}
        <Skeleton className="h-6 w-40 sm:h-7 sm:w-48" />
        <EventGridSkeleton />
      </div>
    </div>
  );
}
