import { EventsExploreViewSkeleton } from '@/components/events-explore-view-skeleton';

// `/events` now renders the same `EventsExploreView` as the home (T-157 alias),
// so its loading state mirrors the home's exactly (same wrapper + full shell:
// hero, search bar, "Latest events" heading, card grid) — no layout shift, and
// no drift from the home skeleton.
//
// ⚠️ It lives in the `(index)` route group ON PURPOSE, exactly like the home's
// own skeleton lives in `(home)` (T-171). At `events/loading.tsx` this file was
// the Suspense fallback for the WHOLE `/events/*` subtree, so navigating to an
// event DETAIL page could paint this explore skeleton — a hero, a search bar
// and a grid of event cards — before the event page arrived. The route group
// scopes it to `/events` itself and leaves `[shareCode]/loading.tsx` as the
// only page-specific fallback under this segment.
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1300px] px-3 pb-10 pt-4 sm:pt-6 sm:px-6 lg:px-8">
      <EventsExploreViewSkeleton />
    </div>
  );
}
