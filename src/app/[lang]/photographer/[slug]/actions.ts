'use server';

import { cacheLife, cacheTag } from 'next/cache';
import {
  buildEventCoverInputs,
  getEventsCoverPaths,
  getPhotographerBySlug,
  getPhotosForEvents,
  getTopPhotographers,
  signEventCoverUrls,
} from '@/database/queries';
import { supabaseAdmin } from '@/database/supabase-admin';
import type { EventWithStats } from '@/hooks/use-event-search';
import { getEventCardPhotoCount } from '@/lib/event-cover-stats';
import { getEventStatus } from '@/lib/event-status';
import { thumbRelativeUrl } from '@/lib/thumbnails';

export type { PhotographerWithStats } from '@/database/queries';

export async function getPhotographerProfileAction(slug: string) {
  'use cache';

  cacheTag(`photographer-${slug}`);
  cacheLife({ revalidate: 15 * 60, expire: 15 * 60 });

  return getPhotographerBySlug(supabaseAdmin, slug);
}

export async function getPhotographerEventsAction(
  userId: string,
  slug: string,
): Promise<{ events: EventWithStats[]; total: number }> {
  'use cache';
  cacheTag(`photographer-${slug}`);
  cacheLife({ revalidate: 15 * 60, expire: 15 * 60 });

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
      coverThumbVersion: number | null;
    }
  >();
  for (const row of photoRows) {
    if (!row.event_id) continue;
    const current = stats.get(row.event_id) ?? {
      count: 0,
      coverPath: null,
      coverThumbReady: false,
      coverThumbVersion: null,
    };
    current.count += 1;
    if (!current.coverPath && row.original_url) {
      current.coverPath = row.original_url;
      current.coverThumbReady = row.thumbnail_status === 'ready';
      current.coverThumbVersion = row.thumb_version ?? null;
    }
    stats.set(row.event_id, current);
  }

  // Prefer the dedicated cover image (T-055), including for events with no
  // photos. A dedicated cover has no thumbnail, so force the thumb off.
  for (const [id, path] of coverOverride) {
    const current = stats.get(id) ?? {
      count: 0,
      coverPath: null,
      coverThumbReady: false,
      coverThumbVersion: null,
    };
    current.coverPath = path;
    current.coverThumbReady = false;
    stats.set(id, current);
  }

  // A first-photo fallback cover for a watermarked/for-sale event routes through
  // the fail-closed /api/watermark/ route — never a direct signed full-res
  // original in the card payload (T-140, shared predicate with the cart/gallery
  // surfaces). Dedicated covers (those in coverOverride) are promotional images
  // → always direct-signed.
  const coverUrls = await signEventCoverUrls(
    supabaseAdmin,
    buildEventCoverInputs(stats, coverOverride, new Map(events.map((e) => [e.id, e]))),
  );

  return {
    events: events.map((event) => ({
      ...event,
      photoCount: getEventCardPhotoCount(event.id, stats),
      coverUrl: coverUrls.get(event.id) ?? null,
      coverThumbUrl: (() => {
        const s = stats.get(event.id);
        return s?.coverThumbReady && s.coverPath
          ? thumbRelativeUrl(s.coverPath, 'small', s.coverThumbVersion)
          : null;
      })(),
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
