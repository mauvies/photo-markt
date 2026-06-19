/**
 * Saved-events (event bookmark) database queries.
 *
 * Talents can "save" an event to bookmark it for easy return. Saved events are
 * NOT owned or joined — this mirrors the talent_photo_tags bookmark pattern one
 * level up, at the event level. All access is the talent's own rows (RLS keyed
 * on user_id).
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

/**
 * Raw saved-event row joined with the underlying event. Photo stats (cover,
 * count) and photographer profile are attached in the action layer, mirroring
 * the explore/top-events enrichment.
 */
export interface SavedEventRow {
  event_id: string;
  user_id: string;
  name: string;
  date: string;
  city: string;
  country: string;
  activity: string;
  slug: string | null;
  price_per_photo: number | null;
  saved_at: string;
}

/** Save (bookmark) an event for a talent. Idempotent — duplicate saves are no-ops. */
export async function saveEventForTalent(
  supabase: SupabaseServerClient,
  userId: string,
  eventId: string,
): Promise<void> {
  const { error } = await supabase.from('talent_saved_events').insert({
    user_id: userId,
    event_id: eventId,
  });

  if (error) {
    // Unique (user_id, event_id) violation — already saved, treat as success.
    if (error.code === '23505') return;
    throw new Error(`Failed to save event for talent: ${getErrorMessage(error)}`);
  }
}

/** Remove a saved event for a talent. */
export async function unsaveEventForTalent(
  supabase: SupabaseServerClient,
  userId: string,
  eventId: string,
): Promise<void> {
  const { error } = await supabase
    .from('talent_saved_events')
    .delete()
    .eq('user_id', userId)
    .eq('event_id', eventId);

  if (error) {
    throw new Error(`Failed to unsave event for talent: ${getErrorMessage(error)}`);
  }
}

/**
 * Update last_seen_at to now for a talent's saved event. No-op if the event
 * isn't saved. Populates data for a future "new photos since last visit" feature.
 */
export async function updateLastSeenAt(
  supabase: SupabaseServerClient,
  userId: string,
  eventId: string,
): Promise<void> {
  const { error } = await supabase
    .from('talent_saved_events')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('event_id', eventId);

  if (error) {
    throw new Error(`Failed to update last_seen_at: ${getErrorMessage(error)}`);
  }
}

/** Whether a specific event is saved by a talent. */
export async function isEventSavedByTalent(
  supabase: SupabaseServerClient,
  userId: string,
  eventId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('talent_saved_events')
    .select('id')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check saved event: ${getErrorMessage(error)}`);
  }

  return data !== null;
}

/** All event ids a talent has saved. Feeds the client-side saved set on cards. */
export async function getSavedEventIdsForTalent(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('talent_saved_events')
    .select('event_id')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to get saved event ids: ${getErrorMessage(error)}`);
  }

  return (data ?? []).map((row: { event_id: string }) => row.event_id);
}

/**
 * A talent's saved events joined with event data, newest-saved first. Excludes
 * soft-deleted events; RLS on the events table additionally hides events the
 * talent can no longer access (e.g. turned private).
 */
export async function getSavedEventsForTalent(
  supabase: SupabaseServerClient,
  userId: string,
  options?: { limit?: number; offset?: number },
): Promise<SavedEventRow[]> {
  const limit = options?.limit ?? 12;
  const offset = options?.offset ?? 0;

  const { data, error } = await supabase
    .from('talent_saved_events')
    .select(
      `
      saved_at,
      events!inner(
        id,
        user_id,
        name,
        date,
        city,
        country,
        activity,
        slug,
        price_per_photo,
        deleted_at
      )
    `,
    )
    .eq('user_id', userId)
    .is('events.deleted_at', null)
    .order('saved_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to get saved events for talent: ${getErrorMessage(error)}`);
  }

  // biome-ignore lint/suspicious/noExplicitAny: PostgREST embed typing is loose here.
  return (data ?? []).map((item: any) => {
    const event = Array.isArray(item.events) ? item.events[0] : item.events;
    return {
      event_id: event?.id,
      user_id: event?.user_id,
      name: event?.name,
      date: event?.date,
      city: event?.city,
      country: event?.country,
      activity: event?.activity,
      slug: event?.slug ?? null,
      price_per_photo: event?.price_per_photo ?? null,
      saved_at: item.saved_at,
    };
  }) as SavedEventRow[];
}

/** Count of a talent's saved events that point to a non-deleted event. */
export async function getSavedEventsCountForTalent(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('talent_saved_events')
    .select('event_id, events!inner(id)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('events.deleted_at', null);

  if (error) {
    throw new Error(`Failed to get saved events count: ${getErrorMessage(error)}`);
  }

  return count ?? 0;
}
