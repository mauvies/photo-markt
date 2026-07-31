import type { AiMatchingStatus } from '@/database/queries/rekognition';

/**
 * The status to actually show the photographer, correcting for the case
 * where `events.ai_matching_status` reports `'ready'` before every applicable
 * photo has reached a terminal indexing state (T-058). The event-detail page
 * derives `status` from the raw column but `pending` from a live per-photo
 * count (`getEventAiIndexingProgress`) — those two can disagree because the
 * worker's completion tracker and the pending-count query aren't read
 * atomically. Never trust `'ready'` while photos remain pending: show
 * `'indexing'` until `pending` reaches 0.
 */
export function displayedAiStatus(snapshot: {
  status: AiMatchingStatus;
  pending: number;
}): AiMatchingStatus {
  if (snapshot.status === 'ready' && snapshot.pending > 0) return 'indexing';
  return snapshot.status;
}

/**
 * Why the card is showing an empty indexing queue (T-209).
 *
 * `totalApplicable` skips photos marked `not_applicable`, so an event with
 * photos and an event with none both rendered "0 of 0 photos indexed" — the
 * line that made a photographer ask why nothing was being indexed.
 *
 * - `no-photos` — the event has no photos. "0 of 0" is honest here.
 * - `none-applicable` — photos exist and every one is `not_applicable`: the
 *   worker ran and found no usable AI setup for the event at that moment
 *   (matching off, minors, or — the case found in staging — no Rekognition
 *   collection materialized yet, because the `event.ai-matching-enabled`
 *   backfill had not created it). Re-indexing is the fix: the backfill lists
 *   `not_applicable` photos, resets them to `pending` and fans them back out.
 * - `none` — there is a real queue; show the normal "X of Y" counter.
 *
 * There is deliberately no "the worker never touched these photos" state:
 * `photos.face_index_status` is `not null default 'pending'`, so an untouched
 * row counts as applicable and already reads "0 of N". An empty queue can only
 * mean no photos or `not_applicable`.
 */
export type AiIndexingNotice = 'none' | 'no-photos' | 'none-applicable';

export function resolveAiIndexingNotice(snapshot: {
  totalPhotos: number;
  totalApplicable: number;
}): AiIndexingNotice {
  if (snapshot.totalApplicable > 0) return 'none';
  return snapshot.totalPhotos === 0 ? 'no-photos' : 'none-applicable';
}

/**
 * True when re-indexing is the action that unblocks the photographer.
 *
 * The card gated Re-index on `ready`/`failed` only, which made `none-applicable`
 * a **dead end**: the event showed "0 of 0" and the one control that would
 * re-drive those photos was greyed out (T-209). `reindexEvent` itself only
 * requires AI matching to be enabled, so it works fine from here.
 */
export function canReindexFromNotice(notice: AiIndexingNotice): boolean {
  return notice === 'none-applicable';
}

/** True while the worker is making progress and the UI should keep polling. */
export function shouldPollAiStatus(snapshot: {
  status: AiMatchingStatus;
  pending: number;
}): boolean {
  if (displayedAiStatus(snapshot) === 'indexing') return true;
  if (snapshot.status === 'idle' && snapshot.pending > 0) return true;
  return false;
}
