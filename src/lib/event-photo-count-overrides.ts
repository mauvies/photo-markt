/**
 * TEMPORARY test-only override.
 *
 * Prod currently has no real users; we need to preview how the public event
 * page renders for events with a large "total photos" count before the real
 * photos are uploaded. This forces the total shown to the client to a FIXED
 * value for a handful of events, keyed by event id.
 *
 * The values are hardcoded (not random) on purpose so the count is stable
 * across reloads and consistent with the page cache — a per-request random
 * number would flicker and bust caching.
 *
 * NOTE: this only rewrites the displayed *total*. The gallery still renders
 * only the real photos that exist, so "load more" stops at the true count.
 *
 * TO REMOVE when the tests are done. It is no longer a single call site (T-229 —
 * the card surfaces disagreed with the event page precisely because it was wired
 * in one place only), so delete ALL of these together:
 *
 *   1. this file;
 *   2. `overrideEventTotalPhotoCount(event.id, approvedCount)` in
 *      `src/app/[lang]/events/[shareCode]/page.tsx` — use `approvedCount`;
 *   3. `getEventCardPhotoCount` in `src/lib/event-cover-stats.ts` — it collapses
 *      to `stats.get(eventId)?.count ?? 0`, which its three callers used before;
 *   4. `test/unit/lib/event-card-photo-count.test.ts`.
 *
 * Leaving any of them behind keeps a live override running in production.
 */
const EVENT_TOTAL_PHOTO_COUNT_OVERRIDES: Record<string, number> = {
  // mussara-costa-dourada-salou-salou-2026
  'c7d3b768-f567-4efc-9aaf-ae4e54ea52bc': 7342,
  // triathlon-international-haute-meuse-2026-anhee-2026
  'fb4ed048-dcc7-42ed-a001-3eaa678ac0fb': 4820,
  // xxvii-gran-fondo-alfarnate-pirineo-costa-del-sol-2026-malaga-2026
  '633d079b-df8e-4821-9fe9-c0273a4e3c38': 9150,
};

/**
 * Returns the fixed override for `eventId` if one is configured, otherwise the
 * real count passed in. Non-overridden events are completely unaffected.
 */
export function overrideEventTotalPhotoCount(eventId: string, realCount: number): number {
  return EVENT_TOTAL_PHOTO_COUNT_OVERRIDES[eventId] ?? realCount;
}
