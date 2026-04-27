'use server';

import { cacheLife, cacheTag } from 'next/cache';
import {
  createSignedUrl,
  getEventFilterOptions,
  getPhotosForEvents,
  type PhotographerSearchResult,
  searchPublicEvents,
} from '@/database/queries';
import { supabaseAdmin } from '@/database/supabase-admin';

export type { PhotographerSearchResult } from '@/database/queries';

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
  const photoRows = await getPhotosForEvents(supabaseAdmin, eventIds);

  const stats = new Map<
    string,
    {
      count: number;
      coverPath: string | null;
    }
  >();

  (photoRows ?? []).forEach((row) => {
    if (!row.event_id) return;
    const current = stats.get(row.event_id) ?? {
      count: 0,
      coverPath: null,
    };
    current.count += 1;
    if (!current.coverPath && row.original_url) {
      current.coverPath = row.original_url;
    }
    stats.set(row.event_id, current);
  });

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
        photographerUsername: profile?.username ?? null,
        photographerDisplayName: profile?.display_name ?? null,
      };
    }),
    total: result.total,
  };
}

export async function getFilterOptionsAction() {
  'use cache';
  cacheTag('filter-options', 'events-public');
  cacheLife('hours');
  return getEventFilterOptions(supabaseAdmin);
}

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
