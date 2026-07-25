import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import { searchEventsAction } from '@/app/[lang]/dashboard/talent/events/actions';
import { useDebounce } from '@/hooks/use-debounce';
import { type EventStatus, getEventStatus } from '@/lib/event-status';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FilterOptions = {
  cities: string[];
  countries: string[];
};

export type EventWithStats = {
  id: string;
  slug: string | null;
  name: string;
  date: string;
  city: string;
  country: string;
  activity: string;
  photoCount: number;
  coverUrl: string | null;
  pricePerPhoto: number | null;
  photographerUsername: string | null;
  photographerDisplayName: string | null;
  /** Photographer avatar (T-119) — null when the profile has none. */
  photographerAvatarUrl?: string | null;
  /** Manual session time (T-106/T-119) — null when unset. */
  session_time?: string | null;
  /** Manual session end time (T-180) — null when unset. */
  session_end_time?: string | null;
  status: EventStatus;
};

export type SortBy = 'date_asc' | 'date_desc' | 'name_asc' | 'name_desc';

type UseEventSearchOptions = {
  initialFilterOptions: FilterOptions;
  initialEvents?: EventWithStats[];
  initialTotal?: number;
  initialWhere?: string;
  initialActivity?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
  initialPhotographerQuery?: string;
  initialLat?: number;
  initialLng?: number;
  initialRadius?: number;
  loadOnMount?: boolean;
};

// ─── Query helpers ────────────────────────────────────────────────────────────

const LIMIT = 20;

/** Normalize a server action result into the shape stored in the cache. */
function normalizeResult(result: Awaited<ReturnType<typeof searchEventsAction>>) {
  return {
    events: result.events.map((e) => ({
      ...e,
      pricePerPhoto: e.price_per_photo,
      status: getEventStatus(e.date),
    })) as EventWithStats[],
    total: result.total,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useEventSearch({
  initialFilterOptions,
  initialEvents,
  initialTotal,
  initialWhere,
  initialActivity,
  initialDateFrom,
  initialDateTo,
  initialPhotographerQuery,
  initialLat,
  initialLng,
  initialRadius,
  loadOnMount = false,
}: UseEventSearchOptions) {
  // ── Filter state ────────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState<string>(() => {
    if (!initialWhere) return '';
    const matchedCity = initialFilterOptions.cities.find(
      (c) => c.toLowerCase() === initialWhere.toLowerCase(),
    );
    const matchedCountry = initialFilterOptions.countries.find(
      (c) => c.toLowerCase() === initialWhere.toLowerCase(),
    );
    return matchedCity || matchedCountry ? '' : initialWhere;
  });

  const [selectedActivity, setSelectedActivity] = useState<string>(initialActivity || 'all');

  const [selectedCity, setSelectedCity] = useState<string>(() => {
    if (!initialWhere) return 'all';
    return (
      initialFilterOptions.cities.find((c) => c.toLowerCase() === initialWhere.toLowerCase()) ??
      'all'
    );
  });

  const [selectedCountry, setSelectedCountry] = useState<string>(() => {
    if (!initialWhere) return 'all';
    return (
      initialFilterOptions.countries.find((c) => c.toLowerCase() === initialWhere.toLowerCase()) ??
      'all'
    );
  });

  const [sortBy, setSortBy] = useState<SortBy>('date_desc');
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? '');
  const [dateTo, setDateTo] = useState(initialDateTo ?? '');
  const [photographerQuery, setPhotographerQuery] = useState(initialPhotographerQuery ?? '');
  const [searchLat, setSearchLat] = useState<number | undefined>(initialLat);
  const [searchLng, setSearchLng] = useState<number | undefined>(initialLng);
  const [radiusKm, setRadiusKm] = useState<number>(initialRadius ?? (initialLat ? 25 : 0));

  // ── Query-enabled gate ──────────────────────────────────────────────────────
  // When loadOnMount=false the query stays disabled until the user explicitly
  // triggers a search (e.g. from the filter bar).
  const [queryEnabled, setQueryEnabled] = useState(loadOnMount || !!initialEvents);

  // ── Misc UI state ───────────────────────────────────────────────────────────
  const [filterOptions] = useState(initialFilterOptions);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

  // ── Debounce ─────────────────────────────────────────────────────────────────
  const debouncedSearch = useDebounce(searchText, 300);

  // ── Query key ────────────────────────────────────────────────────────────────
  // All parameters that affect the result live here. TanStack Query uses this
  // as the cache key: identical keys → instant cache hit, no network request.
  const queryKey = useMemo(
    () =>
      [
        'events',
        {
          search: debouncedSearch.trim(),
          activity: selectedActivity,
          city: selectedCity,
          country: selectedCountry,
          dateFrom,
          dateTo,
          sortBy,
          photographer: photographerQuery.trim(),
          lat: searchLat,
          lng: searchLng,
          radius: radiusKm,
        },
      ] as const,
    [
      debouncedSearch,
      selectedActivity,
      selectedCity,
      selectedCountry,
      dateFrom,
      dateTo,
      sortBy,
      photographerQuery,
      searchLat,
      searchLng,
      radiusKm,
    ],
  );

  // ── Main query ───────────────────────────────────────────────────────────────
  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await searchEventsAction({
        searchText: debouncedSearch.trim() || undefined,
        activities: selectedActivity !== 'all' ? [selectedActivity] : undefined,
        cities: selectedCity !== 'all' ? [selectedCity] : undefined,
        countries: selectedCountry !== 'all' ? [selectedCountry] : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sortBy,
        limit: LIMIT,
        offset: 0,
        photographerQuery: photographerQuery.trim() || undefined,
        lat: searchLat,
        lng: searchLng,
        radiusKm: radiusKm > 0 ? radiusKm : undefined,
      });
      return normalizeResult(result);
    },
    // Server pre-fetched data seeds the cache on first paint (no client fetch on mount).
    // initialDataUpdatedAt: Date.now() tells TanStack Query the data is fresh right now,
    // so it won't immediately trigger a background refetch.
    initialData:
      initialEvents !== undefined ? { events: initialEvents, total: initialTotal ?? 0 } : undefined,
    initialDataUpdatedAt: initialEvents !== undefined ? Date.now() : undefined,
    // Prevent UI flicker: keep rendering the previous result while the next queryKey fetches.
    placeholderData: keepPreviousData,
    enabled: queryEnabled,
  });

  // ── "Load more" (pagination) ─────────────────────────────────────────────────
  // Extra pages are accumulated locally. They're reset whenever the query key
  // changes (i.e. the user applies a new filter) so stale pages don't bleed in.
  const [extraEvents, setExtraEvents] = useState<EventWithStats[]>([]);
  const [page, setPage] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const prevQueryKeyRef = useRef(queryKey);

  useEffect(() => {
    if (prevQueryKeyRef.current !== queryKey) {
      prevQueryKeyRef.current = queryKey;
      setExtraEvents([]);
      setPage(0);
    }
  });

  const baseEvents = data?.events ?? [];
  const events = [...baseEvents, ...extraEvents];
  const total = data?.total ?? 0;
  const hasMore = events.length < total;

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    const nextPage = page + 1;
    setIsLoadingMore(true);
    try {
      const result = await searchEventsAction({
        searchText: debouncedSearch.trim() || undefined,
        activities: selectedActivity !== 'all' ? [selectedActivity] : undefined,
        cities: selectedCity !== 'all' ? [selectedCity] : undefined,
        countries: selectedCountry !== 'all' ? [selectedCountry] : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sortBy,
        limit: LIMIT,
        offset: nextPage * LIMIT,
        photographerQuery: photographerQuery.trim() || undefined,
        lat: searchLat,
        lng: searchLng,
        radiusKm: radiusKm > 0 ? radiusKm : undefined,
      });
      setExtraEvents((prev) => [...prev, ...normalizeResult(result).events]);
      setPage(nextPage);
    } catch (err) {
      console.error('Error loading more events:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    isLoadingMore,
    hasMore,
    page,
    debouncedSearch,
    selectedActivity,
    selectedCity,
    selectedCountry,
    dateFrom,
    dateTo,
    sortBy,
    photographerQuery,
    searchLat,
    searchLng,
    radiusKm,
  ]);

  // ── Derived state ────────────────────────────────────────────────────────────
  const locationLabel =
    selectedCity !== 'all' ? selectedCity : selectedCountry !== 'all' ? selectedCountry : null;

  const hasFilters =
    (selectedActivity && selectedActivity !== 'all') ||
    (selectedCity && selectedCity !== 'all') ||
    (selectedCountry && selectedCountry !== 'all') ||
    !!dateFrom ||
    !!dateTo ||
    !!photographerQuery;

  const activeFilterCount =
    (selectedActivity !== 'all' ? 1 : 0) +
    (selectedCity !== 'all' ? 1 : 0) +
    (selectedCountry !== 'all' ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0) +
    (photographerQuery ? 1 : 0);

  const dateFilterCount = (dateFrom || dateTo ? 1 : 0) + (photographerQuery ? 1 : 0);

  const skeletonKeys = useMemo(() => Array.from({ length: 4 }, (_, i) => `skeleton-${i}`), []);

  const sortedActivityOptions = useMemo(
    () => [...activityOptions].sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  // ── Actions ──────────────────────────────────────────────────────────────────
  const triggerSearch = useCallback(() => {
    if (!queryEnabled) {
      setQueryEnabled(true);
    } else {
      refetch();
    }
  }, [queryEnabled, refetch]);

  /** Called by filter bar dropdowns — enables query and lets the key change drive the fetch. */
  const handleFilterChange = useCallback(
    (setter: (v: string) => void) => (value: string) => {
      setter(value);
      setQueryEnabled(true);
    },
    [],
  );

  const clearFilters = useCallback(() => {
    setSelectedActivity('all');
    setSelectedCity('all');
    setSelectedCountry('all');
    setSearchText('');
    setDateFrom('');
    setDateTo('');
    setPhotographerQuery('');
    if (!loadOnMount) setQueryEnabled(false);
  }, [loadOnMount]);

  const clearDateFilters = useCallback(() => {
    setDateFrom('');
    setDateTo('');
  }, []);

  // Legacy compatibility shim — some consumers call setHasSearched(true/false)
  const setHasSearched = useCallback((value: boolean) => {
    setQueryEnabled(value);
  }, []);

  // ── Loading states ───────────────────────────────────────────────────────────
  // isPending: query is enabled but has no data at all yet (true first-time skeleton)
  // isFetching: any in-flight request (background refresh, filter change, etc.)
  // isLoading: only show full-screen skeleton when there's no cached data to show
  const isLoading = isFetching;
  const isInitialLoad = isPending && queryEnabled;

  return {
    // Filter state
    searchText,
    setSearchText,
    selectedActivity,
    setSelectedActivity,
    selectedCity,
    setSelectedCity,
    selectedCountry,
    setSelectedCountry,
    sortBy,
    setSortBy,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    photographerQuery,
    setPhotographerQuery,
    radiusKm,
    setRadiusKm,
    searchLat,
    setSearchLat,
    searchLng,
    setSearchLng,
    // Data
    events,
    total,
    isLoading,
    isInitialLoad,
    hasSearched: queryEnabled,
    setHasSearched,
    filterOptions,
    sortedActivityOptions,
    isFilterModalOpen,
    setIsFilterModalOpen,
    // Computed
    locationLabel,
    hasMore,
    hasFilters,
    activeFilterCount,
    dateFilterCount,
    skeletonKeys,
    // Actions
    clearFilters,
    clearDateFilters,
    handleFilterChange,
    loadMore: isLoadingMore ? () => {} : loadMore,
    triggerSearch,
  };
}
