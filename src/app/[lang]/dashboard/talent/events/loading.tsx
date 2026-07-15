import { EventGridSkeleton } from '@/components/event-card-skeleton';
import { Skeleton } from '@/components/ui/skeleton';

// The talent dashboard layout already supplies the page margins
// (mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8), so this only needs the
// body content — a search-bar-shaped placeholder plus the real event-card
// grid — mirroring `EventsExploreView`'s `flex flex-col gap-6` shell so
// swapping in the loaded page causes no layout shift (T-128).
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center pb-2">
        <Skeleton className="h-12 w-full max-w-2xl rounded-full" />
      </div>
      <EventGridSkeleton />
    </div>
  );
}
