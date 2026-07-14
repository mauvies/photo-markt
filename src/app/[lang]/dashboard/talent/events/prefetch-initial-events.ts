import type { EventWithStats, FilterOptions } from '@/hooks/use-event-search';
import { getEventStatus } from '@/lib/event-status';
import { searchEventsAction } from './actions';

export type PrefetchedEvents = {
  initialEvents?: EventWithStats[];
  initialTotal?: number;
};

/**
 * Server-side prefetch of the first events page (T-124, F1 of the T-123 perf
 * audit). Mirrors exactly the request `useEventSearch` would fire on mount —
 * same `where` → city/country/free-text mapping, same default sort and page
 * size — so the result can seed the client query (`initialEvents`/
 * `initialTotal`) and the first cards (with their `priority` covers) travel in
 * the initial HTML instead of waiting for hydration + a search-action POST.
 *
 * `searchEventsAction` is `'use cache'` (2 min), so this adds no per-request
 * DB work for repeat visits. On failure it returns `{}` and the caller's
 * `loadOnMount` client fetch takes over — same behavior as before T-124.
 */
export async function prefetchInitialEvents({
  filterOptions,
  where,
  activity,
  dateFrom,
  dateTo,
  photographer,
}: {
  filterOptions: FilterOptions;
  where?: string;
  activity?: string;
  dateFrom?: string;
  dateTo?: string;
  photographer?: string;
}): Promise<PrefetchedEvents> {
  try {
    const matchedCity = filterOptions.cities.find(
      (c) => c.toLowerCase() === (where ?? '').toLowerCase(),
    );
    const matchedCountry = filterOptions.countries.find(
      (c) => c.toLowerCase() === (where ?? '').toLowerCase(),
    );

    const result = await searchEventsAction({
      searchText: matchedCity || matchedCountry ? undefined : where || undefined,
      activities: activity ? [activity] : undefined,
      cities: matchedCity ? [matchedCity] : undefined,
      countries: matchedCountry ? [matchedCountry] : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      photographerQuery: photographer?.trim() || undefined,
    });

    return {
      initialEvents: result.events.map((e) => ({
        ...e,
        pricePerPhoto: e.price_per_photo,
        status: getEventStatus(e.date),
      })),
      initialTotal: result.total,
    };
  } catch {
    // Fall back to the client fetch on mount (pre-T-124 behavior).
    return {};
  }
}
