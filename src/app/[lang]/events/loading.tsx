import { EventGridSkeleton } from '@/components/event-card-skeleton';
import { Skeleton } from '@/components/ui/skeleton';

// Mirrors the page shell in `page.tsx` (`mx-auto max-w-[1400px] w-full
// flex-1 px-4 pt-6 pb-10`) plus a search-bar-shaped placeholder and the
// real event-card grid, so swapping in the loaded page causes no layout
// shift (T-128).
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto max-w-[1400px] w-full flex-1 px-4 pt-6 pb-10">
        <div className="flex justify-center pb-4">
          <Skeleton className="h-12 w-full max-w-2xl rounded-full" />
        </div>
        <EventGridSkeleton />
      </div>
    </div>
  );
}
