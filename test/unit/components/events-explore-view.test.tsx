/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/dictionaries/en.json';

const searchEventsAction = vi.fn();

vi.mock('@/app/[lang]/dashboard/talent/events/actions', () => ({
  searchEventsAction: (...args: unknown[]) => searchEventsAction(...args),
}));

// Capture the props the server view hands to the client grid — the client
// internals (react-query) aren't under test here.
let exploreProps: Record<string, unknown> | undefined;
vi.mock('@/app/[lang]/dashboard/talent/events/explore-page-content', () => ({
  ExplorePageContent: (props: Record<string, unknown>) => {
    exploreProps = props;
    return <div data-testid="explore-page-content" />;
  },
}));

vi.mock('@/components/event-search-bar', () => ({
  EventSearchBar: () => <div data-testid="event-search-bar" />,
}));

import { EventsExploreView } from '@/components/events-explore-view';

const filterOptions = { cities: ['Barcelona'], countries: ['Spain'] };

const rawEvent = {
  id: 'e1',
  slug: 'race-day',
  name: 'Race Day',
  date: '2020-01-01',
  city: 'Barcelona',
  country: 'Spain',
  activity: 'running',
  photoCount: 3,
  coverUrl: 'https://cover',
  price_per_photo: 500,
  photographerUsername: 'ana',
  photographerDisplayName: 'Ana',
};

beforeEach(() => {
  exploreProps = undefined;
  searchEventsAction.mockReset();
  searchEventsAction.mockResolvedValue({ events: [rawEvent], total: 7 });
});

afterEach(cleanup);

async function renderView() {
  const ui = await EventsExploreView({
    dict: en,
    filterOptions,
    searchParams: {},
    basePath: '/',
    eventLinkPrefix: '/events',
  });
  return render(ui);
}

// T-124 (F1 of the T-123 perf audit): the default home/explore view must seed
// the client grid with a server-fetched first page so the LCP cover images
// travel in the initial HTML — before, ExplorePageContent mounted with no
// initialEvents and fetched client-side after hydration.
describe('EventsExploreView server prefetch (T-124)', () => {
  it('server-fetches the first events page and seeds ExplorePageContent', async () => {
    await renderView();
    expect(searchEventsAction).toHaveBeenCalledTimes(1);
    expect(exploreProps?.initialEvents).toHaveLength(1);
    expect(exploreProps?.initialEvents).toMatchObject([
      { id: 'e1', pricePerPhoto: 500, status: 'completed' },
    ]);
    expect(exploreProps?.initialTotal).toBe(7);
  });

  it('keeps the client-fetch fallback enabled when the prefetch fails', async () => {
    searchEventsAction.mockRejectedValue(new Error('db down'));
    await renderView();
    expect(exploreProps?.initialEvents).toBeUndefined();
    expect(exploreProps?.loadOnMount).toBe(true);
  });
});
