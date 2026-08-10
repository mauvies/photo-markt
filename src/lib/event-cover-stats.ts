/**
 * Derive per-event photo count + cover image from a photo row set, for public
 * surfaces (home "Featured events", explore/search results) that must decide
 * whether pending (not-yet-indexed) photos count.
 *
 * T-072: an event with AI matching **configured** genuinely benefits from
 * waiting for its indexing pipeline to promote photos to `approved` — that
 * promotion is the event's real quality/moderation gate. An event **without**
 * AI matching has no such pipeline to wait on, so treating `pending` photos as
 * invisible there just hides real uploads for no reason (the bug this ticket
 * fixes: 264 uploaded-but-not-yet-indexed photos rendered the event
 * cover-less and excluded from "Featured", even though nothing was ever going
 * to index them).
 */

import { overrideEventTotalPhotoCount } from '@/lib/event-photo-count-overrides';

export interface EventPhotoRow {
  event_id: string | null;
  original_url: string | null;
  thumbnail_status?: string | null;
  thumb_version?: number | null;
  upload_status?: string | null;
}

export interface EventCoverStat {
  count: number;
  coverPath: string | null;
  coverThumbReady: boolean;
  /** Cache-bust token of the cover photo's thumbnail — threaded into `?v=N`
   *  so a re-baked (re-blurred) cover busts the immutable CDN cache (T-078). */
  coverThumbVersion: number | null;
}

/**
 * Reduce a `pending + approved` photo row set into per-event stats. Rows for
 * an AI-enabled event are dropped unless `upload_status === 'approved'`; rows
 * for any other event count regardless of status (pending included).
 */
export function resolvePublicEventCoverStats(
  rows: EventPhotoRow[],
  aiEnabledEventIds: Set<string>,
): Map<string, EventCoverStat> {
  const stats = new Map<string, EventCoverStat>();
  for (const row of rows) {
    if (!row.event_id) continue;
    if (aiEnabledEventIds.has(row.event_id) && row.upload_status !== 'approved') continue;

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
  return stats;
}

/**
 * The photo count an event CARD should display (T-229).
 *
 * ⚠️ **The single point where the temporary total-count override reaches the
 * card surfaces.** The override was wired into the event detail page only, so
 * the same event showed one number inside and another one out on the home,
 * `/events`, saved events and the public photographer profile — three
 * independent call sites that each did `stats.get(id)?.count ?? 0` and knew
 * nothing about it.
 *
 * It takes the whole map rather than a count so the override still applies to an
 * event with NO photo rows at all: those never appear in `stats`, and applying
 * the override inside {@link resolvePublicEventCoverStats} would silently skip
 * exactly the events the override exists for.
 *
 * ⚠️ When the override is deleted, this function collapses to
 * `stats.get(eventId)?.count ?? 0` — see the removal list in
 * `event-photo-count-overrides.ts`.
 */
export function getEventCardPhotoCount(
  eventId: string,
  // Structurally minimal on purpose: the saved-events surface builds its own,
  // narrower stats map, and this helper only ever needs the count.
  stats: ReadonlyMap<string, { count: number }>,
): number {
  return overrideEventTotalPhotoCount(eventId, stats.get(eventId)?.count ?? 0);
}
