'use server';

import { cacheLife, cacheTag } from 'next/cache';
import {
  createSignedUrl,
  getEventFilterOptions,
  getEventsCoverPaths,
  getPhotosForEvents,
  type PhotographerSearchResult,
  searchPublicEvents,
} from '@/database/queries';
import { supabaseAdmin } from '@/database/supabase-admin';
import { thumbRelativeUrl } from '@/lib/thumbnails';

export type { PhotographerSearchResult } from '@/database/queries';

/**
 * Search public events with optional filters, enriched with photo counts and signed cover URLs.
 */
export async function searchEventsAction(filters: {
  searchText?: string;
  activities?: string[];
  cities?: string[];
  countries?: string[];
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'date_asc' | 'date_desc' | 'name_asc' | 'name_desc';
  limit?: number;
  offset?: number;
  photographerQuery?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}) {
  'use cache';
  // Cache search results for 2 minutes. Invalidated on any public event mutation
  // via the 'events-public' tag (same tag the mutation actions already revalidate).
  cacheTag('search-results', 'events-public');
  cacheLife({ revalidate: 2 * 60, expire: 2 * 60 });
  const result = await searchPublicEvents(supabaseAdmin, filters).catch(async (err: unknown) => {
    // Graceful fallback: if the lat/lng columns don't exist yet (migration pending),
    // retry without the radius params so the search still works.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('column') && msg.includes('does not exist')) {
      return searchPublicEvents(supabaseAdmin, {
        ...filters,
        lat: undefined,
        lng: undefined,
        radiusKm: undefined,
      });
    }
    throw err;
  });

  // Get cover photos for events
  const eventIds = result.events.map((e) => e.id);
  // Photos and cover paths are independent reads — fetch in parallel.
  const [photoRows, coverOverride] = await Promise.all([
    getPhotosForEvents(supabaseAdmin, eventIds),
    getEventsCoverPaths(supabaseAdmin, eventIds),
  ]);

  const stats = new Map<
    string,
    {
      count: number;
      coverPath: string | null;
      coverThumbReady: boolean;
    }
  >();

  for (const row of photoRows ?? []) {
    if (!row.event_id) continue;
    const current = stats.get(row.event_id) ?? {
      count: 0,
      coverPath: null,
      coverThumbReady: false,
    };
    current.count += 1;
    if (!current.coverPath && row.original_url) {
      current.coverPath = row.original_url;
      current.coverThumbReady = row.thumbnail_status === 'ready';
    }
    stats.set(row.event_id, current);
  }

  // Prefer the dedicated cover image (T-055) over the first photo — including
  // for events with no photos. A dedicated cover has no thumbnail.
  for (const [id, path] of coverOverride) {
    const current = stats.get(id) ?? { count: 0, coverPath: null, coverThumbReady: false };
    current.coverPath = path;
    current.coverThumbReady = false;
    stats.set(id, current);
  }

  // Sign cover URLs
  const coverUrls = new Map<string, string>();
  await Promise.all(
    Array.from(stats.entries()).map(async ([eventId, info]) => {
      if (!info.coverPath) return;
      const signedUrl = await createSignedUrl(supabaseAdmin, 'photos', info.coverPath, 60 * 60);
      if (signedUrl) coverUrls.set(eventId, signedUrl);
    }),
  );

  // Fetch photographer profiles
  const userIds = [...new Set(result.events.map((e) => e.user_id).filter(Boolean))];
  const { data: profileRows } = await supabaseAdmin
    .from('profiles')
    .select('id, username, display_name')
    .in('id', userIds);

  const profileMap = new Map<string, { username: string | null; display_name: string | null }>();
  for (const p of profileRows ?? []) {
    profileMap.set(p.id, p);
  }

  return {
    events: result.events.map((event) => {
      const profile = profileMap.get(event.user_id);
      return {
        ...event,
        photoCount: stats.get(event.id)?.count ?? 0,
        coverUrl: coverUrls.get(event.id) ?? null,
        coverThumbUrl: (() => {
          const s = stats.get(event.id);
          return s?.coverThumbReady && s.coverPath ? thumbRelativeUrl(s.coverPath, 'small') : null;
        })(),
        photographerUsername: profile?.username ?? null,
        photographerDisplayName: profile?.display_name ?? null,
      };
    }),
    total: result.total,
  };
}

/** Return available filter options (activities, cities, countries) for the event search UI. */
export async function getFilterOptionsAction() {
  'use cache';
  cacheTag('filter-options', 'events-public');
  cacheLife('hours');
  return getEventFilterOptions(supabaseAdmin);
}

/**
 * Search photographers by username or display name.
 * Only returns users who have at least one public event.
 */
export async function searchPhotographersAction(
  query: string,
): Promise<PhotographerSearchResult[]> {
  if (!query.trim()) return [];

  const term = `%${query.trim()}%`;

  // Find profiles matching the query that have at least one public event.
  // We don't restrict by active_role because a user may currently be in
  // TALENT mode but still have photographer events.
  const { data: profileMatches } = await supabaseAdmin
    .from('profiles')
    .select('id, username, slug, display_name, avatar_url')
    .or(`username.ilike.${term},display_name.ilike.${term}`)
    .limit(10);

  if (!profileMatches?.length) return [];

  const userIds = profileMatches.map((p) => p.id);

  // Only include users who have at least one public non-deleted event.
  const { data: eventRows } = await supabaseAdmin
    .from('events')
    .select('user_id')
    .in('user_id', userIds)
    .eq('is_public', true)
    .is('deleted_at', null);

  const countMap = new Map<string, number>();
  for (const row of eventRows ?? []) {
    countMap.set(row.user_id, (countMap.get(row.user_id) ?? 0) + 1);
  }

  return profileMatches
    .filter((p) => (countMap.get(p.id) ?? 0) > 0)
    .slice(0, 4)
    .map((p) => ({
      id: p.id,
      username: p.username,
      slug: p.slug ?? p.username,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      event_count: countMap.get(p.id) ?? 0,
    }));
}

/** Return up to 6 distinct event names matching the query (for autocomplete). */
export async function searchEventNamesAction(query: string): Promise<string[]> {
  if (!query.trim()) return [];
  const { data } = await supabaseAdmin
    .from('events')
    .select('name')
    .eq('is_public', true)
    .is('deleted_at', null)
    .ilike('name', `%${query.trim()}%`)
    .order('name')
    .limit(6);
  return [...new Set((data ?? []).map((r: { name: string }) => r.name))];
}

export type EventSuggestion = {
  id: string;
  name: string;
  slug: string | null;
  city: string;
};

/**
 * Combined search for the "where" dropdown: returns events matching name or city,
 * and photographers matching display_name — all via Supabase ILIKE, no external APIs.
 */
export async function searchSuggestionsAction(query: string): Promise<{
  events: EventSuggestion[];
  photographers: PhotographerSearchResult[];
}> {
  if (!query.trim()) return { events: [], photographers: [] };
  const term = `%${query.trim()}%`;

  const [eventsResult, profileMatches] = await Promise.all([
    supabaseAdmin
      .from('events')
      .select('id, name, slug, city')
      .eq('is_public', true)
      .is('deleted_at', null)
      .or(`name.ilike.${term},city.ilike.${term}`)
      .order('name')
      .limit(5),
    supabaseAdmin
      .from('profiles')
      .select('id, username, slug, display_name, avatar_url')
      .or(`username.ilike.${term},display_name.ilike.${term}`)
      .limit(10),
  ]);

  const events = (eventsResult.data ?? []) as EventSuggestion[];

  const profileIds = (profileMatches.data ?? []).map((p: { id: string }) => p.id);
  let photographers: PhotographerSearchResult[] = [];

  if (profileIds.length > 0) {
    const { data: eventRows } = await supabaseAdmin
      .from('events')
      .select('user_id')
      .in('user_id', profileIds)
      .eq('is_public', true)
      .is('deleted_at', null);

    const countMap = new Map<string, number>();
    for (const row of eventRows ?? []) {
      countMap.set(row.user_id, (countMap.get(row.user_id) ?? 0) + 1);
    }

    photographers = (profileMatches.data ?? [])
      .filter((p: { id: string }) => (countMap.get(p.id) ?? 0) > 0)
      .slice(0, 4)
      .map(
        (p: {
          id: string;
          username: string;
          slug: string | null;
          display_name: string | null;
          avatar_url: string | null;
        }) => ({
          id: p.id,
          username: p.username,
          slug: p.slug ?? p.username,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          event_count: countMap.get(p.id) ?? 0,
        }),
      );
  }

  return { events, photographers };
}
