import { cacheLife, cacheTag } from 'next/cache';
import { createSignedUrl, getPhotosForEvents, getTopEvents } from '@/database/queries';
import { supabaseAdmin } from '@/database/supabase-admin';
import { type EventStatus, getEventStatus } from '@/lib/event-status';
import { thumbRelativeUrl } from '@/lib/thumbnails';

// Up to 4 of each status are returned so the client can filter the
// All / Upcoming / Completed views without a server round-trip.
const PER_STATUS_LIMIT = 4;
const CANDIDATE_LIMIT = 50;

export type TopEventItem = {
  id: string;
  name: string;
  date: string;
  city: string;
  country: string;
  activity: string;
  slug: string | null;
  pricePerPhoto: number | null;
  photoCount: number;
  coverUrl: string | null;
  /** /api/thumb/.../small.webp — set when the cover photo has thumbnails ready. */
  coverThumbUrl: string | null;
  photographerUsername: string | null;
  photographerDisplayName: string | null;
  status: EventStatus;
};

export async function getCachedTopEvents(): Promise<TopEventItem[]> {
  'use cache';
  cacheTag('top-events');
  // 55 min TTL — safely under the 60-min signed URL expiry
  cacheLife({ revalidate: 55 * 60, expire: 55 * 60 });

  const candidates = await getTopEvents(supabaseAdmin, CANDIDATE_LIMIT);

  const eventIds = candidates.map((e) => e.id);
  const photoRows = await getPhotosForEvents(supabaseAdmin, eventIds);

  const stats = new Map<
    string,
    { count: number; coverPath: string | null; coverThumbReady: boolean }
  >();
  for (const row of photoRows) {
    if (!row.event_id) continue;
    const s = stats.get(row.event_id) ?? { count: 0, coverPath: null, coverThumbReady: false };
    s.count++;
    if (!s.coverPath && row.original_url) {
      s.coverPath = row.original_url;
      s.coverThumbReady = row.thumbnail_status === 'ready';
    }
    stats.set(row.event_id, s);
  }

  const now = Date.now();
  const scored = candidates
    .filter((e) => (stats.get(e.id)?.count ?? 0) >= 1)
    .map((e) => {
      const photoCount = stats.get(e.id)?.count ?? 0;
      const ageDays = (now - new Date(e.created_at).getTime()) / (1000 * 60 * 60 * 24);
      // Events ≤7 days old score 1.0 for recency; older events decay as 7/ageDays
      const recencyScore = ageDays <= 7 ? 1.0 : 7 / ageDays;
      const score = photoCount * 0.4 + recencyScore * 0.6;
      return {
        ...e,
        photoCount,
        coverPath: stats.get(e.id)?.coverPath ?? null,
        coverThumbReady: stats.get(e.id)?.coverThumbReady ?? false,
        score,
        status: getEventStatus(e.date),
      };
    })
    .sort((a, b) => b.score - a.score);

  // Up to 4 upcoming + 4 completed, scored order within each group. The
  // client filters this set for the All / Upcoming / Completed views.
  const upcoming = scored.filter((e) => e.status === 'upcoming').slice(0, PER_STATUS_LIMIT);
  const completed = scored.filter((e) => e.status === 'completed').slice(0, PER_STATUS_LIMIT);
  const selected = [...upcoming, ...completed];

  const coverUrls = new Map<string, string>();
  await Promise.all(
    selected.map(async (e) => {
      if (!e.coverPath) return;
      const url = await createSignedUrl(supabaseAdmin, 'photos', e.coverPath, 60 * 60);
      if (url) coverUrls.set(e.id, url);
    }),
  );

  const userIds = [...new Set(selected.map((e) => e.user_id))];
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, username, display_name')
    .in('id', userIds);
  const profileMap = new Map(
    (profiles ?? []).map(
      (p: { id: string; username: string | null; display_name: string | null }) => [p.id, p],
    ),
  );

  return selected.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    city: e.city,
    country: e.country,
    activity: e.activity,
    slug: e.slug,
    pricePerPhoto: e.price_per_photo,
    photoCount: e.photoCount,
    coverUrl: coverUrls.get(e.id) ?? null,
    coverThumbUrl: e.coverThumbReady && e.coverPath ? thumbRelativeUrl(e.coverPath, 'small') : null,
    photographerUsername: profileMap.get(e.user_id)?.username ?? null,
    photographerDisplayName: profileMap.get(e.user_id)?.display_name ?? null,
    status: e.status,
  }));
}
