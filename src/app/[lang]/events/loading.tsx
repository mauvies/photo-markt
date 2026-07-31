import { EventsExploreViewSkeleton } from '@/components/events-explore-view-skeleton';

// `/events` now renders the same `EventsExploreView` as the home (T-157 alias),
// so its loading state mirrors the home's exactly (same wrapper + full shell:
// hero, search bar, "Latest events" heading, card grid) — no layout shift, and
// no drift from the home skeleton.
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1300px] px-3 pb-10 pt-4 sm:pt-6 sm:px-6 lg:px-8">
      <EventsExploreViewSkeleton />
    </div>
  );
}
