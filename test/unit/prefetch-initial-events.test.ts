import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchEventsAction = vi.fn();

vi.mock('@/app/[lang]/dashboard/talent/events/actions', () => ({
  searchEventsAction: (...args: unknown[]) => searchEventsAction(...args),
}));

import { prefetchInitialEvents } from '@/app/[lang]/dashboard/talent/events/prefetch-initial-events';

const filterOptions = {
  cities: ['Barcelona', 'Madrid'],
  countries: ['Spain', 'France'],
};

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
  searchEventsAction.mockReset();
  searchEventsAction.mockResolvedValue({ events: [rawEvent], total: 1 });
});

// T-124: the server prefetch must mirror the exact request useEventSearch
// fires on mount, so the seeded initialData matches the client's query key.
describe('prefetchInitialEvents', () => {
  it('fetches the default first page when no filters are present', async () => {
    const result = await prefetchInitialEvents({ filterOptions });
    expect(searchEventsAction).toHaveBeenCalledWith({
      searchText: undefined,
      activities: undefined,
      cities: undefined,
      countries: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      photographerQuery: undefined,
    });
    expect(result.initialTotal).toBe(1);
  });

  it('maps a `where` that matches a known city to the cities filter (case-insensitive)', async () => {
    await prefetchInitialEvents({ filterOptions, where: 'barcelona' });
    expect(searchEventsAction).toHaveBeenCalledWith(
      expect.objectContaining({ cities: ['Barcelona'], searchText: undefined }),
    );
  });

  it('maps a `where` that matches a known country to the countries filter', async () => {
    await prefetchInitialEvents({ filterOptions, where: 'spain' });
    expect(searchEventsAction).toHaveBeenCalledWith(
      expect.objectContaining({ countries: ['Spain'], searchText: undefined }),
    );
  });

  it('passes an unmatched `where` through as free-text search', async () => {
    await prefetchInitialEvents({ filterOptions, where: 'trail 10k' });
    expect(searchEventsAction).toHaveBeenCalledWith(
      expect.objectContaining({ searchText: 'trail 10k', cities: undefined, countries: undefined }),
    );
  });

  it('forwards activity, dates and trimmed photographer query', async () => {
    await prefetchInitialEvents({
      filterOptions,
      activity: 'running',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      photographer: ' ana ',
    });
    expect(searchEventsAction).toHaveBeenCalledWith(
      expect.objectContaining({
        activities: ['running'],
        dateFrom: '2026-01-01',
        dateTo: '2026-02-01',
        photographerQuery: 'ana',
      }),
    );
  });

  it('normalizes rows like the client hook (pricePerPhoto + derived status)', async () => {
    const { initialEvents } = await prefetchInitialEvents({ filterOptions });
    expect(initialEvents?.[0]).toMatchObject({
      id: 'e1',
      pricePerPhoto: 500,
      status: 'completed',
    });
  });

  it('returns an empty result when the search action fails (client fallback)', async () => {
    searchEventsAction.mockRejectedValue(new Error('db down'));
    const result = await prefetchInitialEvents({ filterOptions });
    expect(result).toEqual({});
  });
});
