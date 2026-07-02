import type { UploadStage } from '@/lib/use-photo-upload';

/**
 * Decide whether a just-created event should be soft-deleted as an orphan.
 *
 * The wizard persists the event first (it needs the `eventId` to mint signed
 * upload URLs), then uploads photos. If that upload flow fails outright or the
 * user cancels it, the event would otherwise linger as an orphan the user never
 * meant to keep (the bug reported in T-054).
 *
 * Discard only when the flow ended in a hard-stop terminal state (`error` from
 * a thrown run, or `cancelled`) AND nothing was successfully attached. A
 * `partial-failed` result — or any terminal state where at least one photo made
 * it in — leaves a real event with real content, so we keep it.
 */
export function shouldDiscardCreatedEvent(stage: UploadStage, attachedCount: number): boolean {
  if (attachedCount > 0) return false;
  return stage === 'error' || stage === 'cancelled';
}
