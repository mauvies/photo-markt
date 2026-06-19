/**
 * Photographer public-profile queries
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export interface PublicPhotographerProfile {
  id: string;
  username: string;
  slug: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  city: string | null;
  country_code: string | null;
  created_at: string;
}

export interface PhotographerWithStats extends PublicPhotographerProfile {
  eventCount: number;
  photoCount: number;
  photosSoldCount: number;
}

export interface PhotographerSearchResult {
  id: string;
  username: string;
  slug: string;
  display_name: string | null;
  avatar_url: string | null;
  event_count: number;
}

/**
 * Fetch a photographer's public profile and stats by their slug.
 * Returns null when no matching photographer exists.
 */
export async function getPhotographerBySlug(
  supabase: SupabaseServerClient,
  slug: string,
): Promise<PhotographerWithStats | null> {
  // Try slug column first, then fall back to username (handles profiles where slug is not set).
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, slug, display_name, bio, avatar_url, city, country_code, created_at')
    .or(`slug.eq.${slug},username.eq.${slug}`)
    .maybeSingle();

  if (error) throw new Error(`Failed to get photographer: ${getErrorMessage(error)}`);
  if (!data) return null;

  // All three stats run in parallel.
  // - eventCount: non-deleted PUBLIC events authored by this photographer.
  // - photoCount: photos belonging to those public events only (scopes to
  //   what's actually visible on the public profile, not total uploads).
  // - photosSoldCount: line items from completed orders attributed to this
  //   photographer (one count per photo sold, including repeat sales).
  const [eventsRes, photosRes, salesRes] = await Promise.all([
    supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', data.id)
      .eq('is_public', true)
      .is('deleted_at', null),
    supabase
      .from('photos')
      .select('id, events!inner(user_id, is_public, deleted_at)', { count: 'exact', head: true })
      .eq('events.user_id', data.id)
      .eq('events.is_public', true)
      .is('events.deleted_at', null),
    supabase
      .from('order_items')
      .select('id, orders!inner(status)', { count: 'exact', head: true })
      .eq('photographer_id', data.id)
      .eq('orders.status', 'completed'),
  ]);

  return {
    ...data,
    slug: data.slug ?? data.username,
    eventCount: eventsRes.count ?? 0,
    photoCount: photosRes.count ?? 0,
    photosSoldCount: salesRes.count ?? 0,
  };
}

/**
 * Search photographers by display_name or username.
 * Returns up to `limit` results with their public event count.
 */
export async function searchPhotographers(
  supabase: SupabaseServerClient,
  query: string,
  limit = 6,
): Promise<PhotographerSearchResult[]> {
  if (!query.trim()) return [];

  const term = `%${query.trim()}%`;
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, username, slug, display_name, avatar_url')
    .eq('active_role', 'PHOTOGRAPHER')
    .or(`username.ilike.${term},display_name.ilike.${term}`)
    .limit(limit);

  if (error) throw new Error(`Failed to search photographers: ${getErrorMessage(error)}`);
  if (!profiles?.length) return [];

  // Fetch event counts for matched photographers
  const userIds = profiles.map((p) => p.id);
  const { data: eventRows } = await supabase
    .from('events')
    .select('user_id')
    .in('user_id', userIds)
    .is('deleted_at', null);

  const countMap = new Map<string, number>();
  for (const row of eventRows ?? []) {
    countMap.set(row.user_id, (countMap.get(row.user_id) ?? 0) + 1);
  }

  return profiles.map((p) => ({
    id: p.id,
    username: p.username,
    slug: p.slug ?? p.username,
    display_name: p.display_name,
    avatar_url: p.avatar_url,
    event_count: countMap.get(p.id) ?? 0,
  }));
}

/**
 * Return the top photographers (by total event count) for generateStaticParams.
 */
export async function getTopPhotographers(
  supabase: SupabaseServerClient,
  limit = 50,
): Promise<{ slug: string }[]> {
  // Fetch photographers that have a slug set
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, slug, username')
    .eq('active_role', 'PHOTOGRAPHER')
    .not('slug', 'is', null)
    .limit(200);

  if (!profiles?.length) return [];

  // Rank by event count
  const userIds = profiles.map((p) => p.id);
  const { data: eventRows } = await supabase
    .from('events')
    .select('user_id')
    .in('user_id', userIds)
    .is('deleted_at', null);

  const countMap = new Map<string, number>();
  for (const row of eventRows ?? []) {
    countMap.set(row.user_id, (countMap.get(row.user_id) ?? 0) + 1);
  }

  return profiles
    .sort((a, b) => (countMap.get(b.id) ?? 0) - (countMap.get(a.id) ?? 0))
    .slice(0, limit)
    .map((p) => ({ slug: p.slug ?? p.username }));
}
