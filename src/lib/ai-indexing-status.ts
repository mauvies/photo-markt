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

/** True while the worker is making progress and the UI should keep polling. */
export function shouldPollAiStatus(snapshot: {
  status: AiMatchingStatus;
  pending: number;
}): boolean {
  if (displayedAiStatus(snapshot) === 'indexing') return true;
  if (snapshot.status === 'idle' && snapshot.pending > 0) return true;
  return false;
}
