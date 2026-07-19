import { EventsExploreViewSkeleton } from '@/components/events-explore-view-skeleton';

// The talent dashboard layout already supplies the page margins
// (mx-auto max-w-[1300px] px-4 sm:px-6 lg:px-8), so this only needs the body
// content — the full `EventsExploreView` shell (hero, search bar, "Latest
// events" heading, card grid) — so swapping in the loaded page causes no
// layout shift (T-156, follow-up of T-128 which only synced the card grid).
export default function Loading() {
  return <EventsExploreViewSkeleton />;
}
