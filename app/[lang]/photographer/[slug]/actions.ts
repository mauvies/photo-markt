'use server';

import { cacheLife, cacheTag } from 'next/cache';
import {
  createSignedUrl,
  getPhotographerBySlug,
  getPhotosForEvents,
  getTopPhotographers,
} from '@/database/queries';
import { supabaseAdmin } from '@/database/supabase-admin';
import type { EventWithStats } from '@/hooks/use-event-search';
import { getEventStatus } from '@/lib/event-status';

export type { PhotographerWithStats } from '@/database/queries';

export async function getPhotographerProfileAction(slug: string) {
  'use cache';

  cacheTag(`photographer-${slug}`);
  cacheLife('minutes');

  return getPhotographerBySlug(supabaseAdmin, slug);
}

export async function getPhotographerEventsAction(
  userId: string,
  slug: string,
): Promise<{ events: EventWithStats[]; total: number }> {
  'use cache';
  cacheTag(`photographer-${slug}`);
  cacheLife('minutes');

  // Fetch only PUBLIC, non-deleted events — the public profile must not
  // surface private events.
  const { data: events, count } = await supabaseAdmin
    .from('events')
    .select(
      'id, user_id, name, date, city, country, state, activity, is_public, share_code, slug, price_per_photo, watermark_enabled',
      { count: 'exact' },
    )
    .eq('user_id', userId)
    .eq('is_public', true)
    .is('deleted_at', null)
    .order('date', { ascending: false })
    .limit(100);

  if (!events?.length) return { events: [], total: 0 };

  // Enrich with photo counts and signed cover URLs (mirrors searchEventsAction logic)
  const eventIds = events.map((e) => e.id);
  const photoRows = await getPhotosForEvents(supabaseAdmin, eventIds);

  const stats = new Map<string, { count: number; coverPath: string | null }>();
  for (const row of photoRows) {
    if (!row.event_id) continue;
    const current = stats.get(row.event_id) ?? { count: 0, coverPath: null };
    current.count += 1;
    if (!current.coverPath && row.original_url) current.coverPath = row.original_url;
    stats.set(row.event_id, current);
  }

  const coverUrls = new Map<string, string>();
  await Promise.all(
    Array.from(stats.entries()).map(async ([eventId, info]) => {
      if (!info.coverPath) return;
      const signed = await createSignedUrl(supabaseAdmin, 'photos', info.coverPath, 3600);
      if (signed) coverUrls.set(eventId, signed);
    }),
  );

  return {
    events: events.map((event) => ({
      ...event,
      photoCount: stats.get(event.id)?.count ?? 0,
      coverUrl: coverUrls.get(event.id) ?? null,
      pricePerPhoto: event.price_per_photo,
      photographerUsername: null,
      photographerDisplayName: null,
      status: getEventStatus(event.date),
    })),
    total: count ?? 0,
  };
}

export async function getTopPhotographersAction() {
  return getTopPhotographers(supabaseAdmin, 50);
}
