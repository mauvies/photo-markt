import { cacheLife, cacheTag } from 'next/cache';
import {
  createSignedUrl,
  getEventsCoverPaths,
  getPhotosForEventsIncludingPending,
  getTopEvents,
} from '@/database/queries';
import { supabaseAdmin } from '@/database/supabase-admin';
import { resolvePublicEventCoverStats } from '@/lib/event-cover-stats';
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
  const photoRows = await getPhotosForEventsIncludingPending(supabaseAdmin, eventIds);

  // T-072: an event with AI matching configured waits for its indexing
  // pipeline to promote photos to `approved` (that promotion IS the
  // moderation/quality gate); an event without AI matching has no such
  // pipeline, so pending photos count immediately — otherwise a fully
  // uploaded, non-AI event would sit cover-less and unfeatured forever.
  const aiEnabledEventIds = new Set(
    candidates.filter((e) => e.ai_matching_enabled).map((e) => e.id),
  );
  const stats = resolvePublicEventCoverStats(photoRows, aiEnabledEventIds);

  const now = Date.now();
  const scored = candidates
    // Featured/top events require ≥1 (visible) photo on purpose: a home-page
    // card that leads to an event with nothing to browse is bad UX. So a
    // cover-only, zero-photo event is intentionally NOT featured here (unlike
    // the talent search / profile lists, which do surface cover-only events).
    // "Visible" is AI-conditional (see resolvePublicEventCoverStats, T-072).
    // The cover override below only restyles events that already qualify.
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
        coverThumbVersion: stats.get(e.id)?.coverThumbVersion ?? null,
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

  // Prefer the dedicated cover image (T-055). A dedicated cover has no
  // thumbnail, so force the thumb off so the card uses the full signed cover.
  const coverOverride = await getEventsCoverPaths(
    supabaseAdmin,
    selected.map((e) => e.id),
  );
  for (const e of selected) {
    const override = coverOverride.get(e.id);
    if (override) {
      e.coverPath = override;
      e.coverThumbReady = false;
    }
  }

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
    coverThumbUrl:
      e.coverThumbReady && e.coverPath
        ? thumbRelativeUrl(e.coverPath, 'small', e.coverThumbVersion)
        : null,
    photographerUsername: profileMap.get(e.user_id)?.username ?? null,
    photographerDisplayName: profileMap.get(e.user_id)?.display_name ?? null,
    status: e.status,
  }));
}
