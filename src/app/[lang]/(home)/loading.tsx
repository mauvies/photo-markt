import { EventsExploreViewSkeleton } from '@/components/events-explore-view-skeleton';

// Mirrors `page.tsx`'s wrapper (`mx-auto w-full max-w-[1300px] px-3 pb-10
// pt-4 sm:pt-6 sm:px-6 lg:px-8`) plus the full `EventsExploreView` shell
// (hero, search bar, "Latest events" heading, card grid) so the first paint
// doesn't jump once real content hydrates (T-156).
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1300px] px-3 pb-10 pt-4 sm:pt-6 sm:px-6 lg:px-8">
      <EventsExploreViewSkeleton />
    </div>
  );
}
