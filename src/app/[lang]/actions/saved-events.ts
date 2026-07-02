'use server';

import { revalidatePath } from 'next/cache';
import { userHasRole } from '@/app/[lang]/actions/roles';
import {
  createSignedUrl,
  getEventsCoverPaths,
  getPhotosForEvents,
  getSavedEventIdsForTalent,
  getSavedEventsCountForTalent,
  getSavedEventsForTalent,
  type SavedEventRow,
  saveEventForTalent,
  unsaveEventForTalent,
  updateLastSeenAt,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { type EventStatus, getEventStatus } from '@/lib/event-status';

const SAVED_EVENTS_PATHS = [
  '/es/dashboard/talent/favorites',
  '/en/dashboard/talent/favorites',
] as const;

/** Event-card data for a saved event, matching the explore EventWithStats shape. */
export type SavedEventCard = {
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
  status: EventStatus;
};

/**
 * Resolve the current user and assert they are an authenticated talent. Throws
 * otherwise — every mutation gates on this server-side, never trusting the client.
 */
async function requireTalent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to manage saved events.');
  }

  // Gate by capability, not active view — active_role is a mutable UI preference.
  if (!(await userHasRole('talent'))) {
    throw new Error('Only talent users can manage saved events.');
  }

  return { supabase, user };
}

/** Save (bookmark) an event for the current talent. */
export async function saveEvent(eventId: string): Promise<{ ok: true }> {
  const { supabase, user } = await requireTalent();
  await saveEventForTalent(supabase, user.id, eventId);
  for (const path of SAVED_EVENTS_PATHS) revalidatePath(path, 'page');
  return { ok: true };
}

/** Remove a saved event for the current talent. */
export async function unsaveEvent(eventId: string): Promise<{ ok: true }> {
  const { supabase, user } = await requireTalent();
  await unsaveEventForTalent(supabase, user.id, eventId);
  for (const path of SAVED_EVENTS_PATHS) revalidatePath(path, 'page');
  return { ok: true };
}

/**
 * Mark a saved event as seen (updates last_seen_at). Called once per visit from
 * the talent event-detail view. No-op if the event isn't saved.
 */
export async function markEventSeen(eventId: string): Promise<void> {
  const { supabase, user } = await requireTalent();
  await updateLastSeenAt(supabase, user.id, eventId);
}

/**
 * Guest/photographer-safe lookup powering the client saved-events hook. Returns
 * an empty, non-talent shape for unauthenticated users and photographers so the
 * save button can stay hidden without throwing.
 */
export async function getSavedEventIdsAction(): Promise<{
  isTalent: boolean;
  savedEventIds: string[];
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { isTalent: false, savedEventIds: [] };

  // Capability, not active view — a talent-capable user gets their saved events
  // regardless of which dashboard they last switched to.
  if (!(await userHasRole('talent'))) return { isTalent: false, savedEventIds: [] };

  const savedEventIds = await getSavedEventIdsForTalent(supabase, user.id);
  return { isTalent: true, savedEventIds };
}

/** Enrich saved-event rows with photo stats and photographer profile (admin client). */
async function enrichSavedEvents(rows: SavedEventRow[]): Promise<SavedEventCard[]> {
  if (rows.length === 0) return [];

  const eventIds = rows.map((r) => r.event_id);
  // Photos and cover paths are independent reads — fetch in parallel.
  const [photoRows, coverOverride] = await Promise.all([
    getPhotosForEvents(supabaseAdmin, eventIds),
    getEventsCoverPaths(supabaseAdmin, eventIds),
  ]);

  const stats = new Map<string, { count: number; coverPath: string | null }>();
  for (const row of photoRows ?? []) {
    if (!row.event_id) continue;
    const current = stats.get(row.event_id) ?? { count: 0, coverPath: null };
    current.count += 1;
    if (!current.coverPath && row.original_url) current.coverPath = row.original_url;
    stats.set(row.event_id, current);
  }

  // Prefer the dedicated cover image (T-055), including for events with no photos.
  for (const [id, path] of coverOverride) {
    const current = stats.get(id) ?? { count: 0, coverPath: null };
    current.coverPath = path;
    stats.set(id, current);
  }

  const coverUrls = new Map<string, string>();
  await Promise.all(
    Array.from(stats.entries()).map(async ([eventId, info]) => {
      if (!info.coverPath) return;
      const signedUrl = await createSignedUrl(supabaseAdmin, 'photos', info.coverPath, 60 * 60);
      if (signedUrl) coverUrls.set(eventId, signedUrl);
    }),
  );

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const { data: profileRows } = await supabaseAdmin
    .from('profiles')
    .select('id, username, display_name')
    .in('id', userIds);
  const profileMap = new Map<string, { username: string | null; display_name: string | null }>();
  for (const p of profileRows ?? []) profileMap.set(p.id, p);

  return rows.map((row) => {
    const profile = profileMap.get(row.user_id);
    return {
      id: row.event_id,
      slug: row.slug,
      name: row.name,
      date: row.date,
      city: row.city,
      country: row.country,
      activity: row.activity,
      photoCount: stats.get(row.event_id)?.count ?? 0,
      coverUrl: coverUrls.get(row.event_id) ?? null,
      pricePerPhoto: row.price_per_photo,
      photographerUsername: profile?.username ?? null,
      photographerDisplayName: profile?.display_name ?? null,
      status: getEventStatus(row.date),
    };
  });
}

/** Paginated saved-event cards for the Favorites → Events tab. */
export async function listSavedEvents(options?: {
  limit?: number;
  offset?: number;
}): Promise<{ events: SavedEventCard[]; hasMore: boolean }> {
  const { supabase, user } = await requireTalent();
  const limit = options?.limit ?? 12;
  const offset = options?.offset ?? 0;

  const [rows, totalCount] = await Promise.all([
    getSavedEventsForTalent(supabase, user.id, { limit, offset }),
    getSavedEventsCountForTalent(supabase, user.id),
  ]);

  const events = await enrichSavedEvents(rows);
  return { events, hasMore: offset + rows.length < totalCount };
}
