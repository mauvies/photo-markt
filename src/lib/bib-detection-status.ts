import type { BibDetectionEventStatus, BibDetectionStatus } from '@/database/queries/bib-numbers';

/**
 * Aggregate bib-detection counts the owner's status card renders. Mirrors the
 * shape `getEventAiIndexingProgress` produces for face indexing, kept in this
 * pure module so the derivation is unit-testable without a database (T-139).
 */
export interface BibDetectionProgress {
  /** Photos the detector acts on — excludes NULL ("never ran") / `not_applicable`. */
  totalApplicable: number;
  /** Reached a terminal detection state (`detected` + `no_bibs`). */
  processed: number;
  /** Still in flight (`pending` + `detecting`). */
  pending: number;
  /** Terminally `failed`. */
  failed: number;
  /** Of the processed photos, how many actually carry bib numbers (`detected`). */
  withBibs: number;
}

/**
 * Reduce a list of per-photo `bib_detection_status` values into the aggregate
 * counts the status card shows. A NULL status means detection never ran for
 * that photo (event opted in after upload, or a face-only event), and
 * `not_applicable` is an explicit skip — both are excluded from the applicable
 * total so "processed vs total" only measures photos the detector touches.
 */
export function summarizeBibDetectionProgress(
  statuses: Array<BibDetectionStatus | null>,
): BibDetectionProgress {
  let totalApplicable = 0;
  let processed = 0;
  let pending = 0;
  let failed = 0;
  let withBibs = 0;
  for (const status of statuses) {
    if (!status || status === 'not_applicable') continue;
    totalApplicable += 1;
    if (status === 'detected') {
      processed += 1;
      withBibs += 1;
    } else if (status === 'no_bibs') {
      processed += 1;
    } else if (status === 'failed') {
      failed += 1;
    } else {
      // `pending` | `detecting`
      pending += 1;
    }
  }
  return { totalApplicable, processed, pending, failed, withBibs };
}

/**
 * The status to actually show the photographer, correcting for the case where
 * `events.bib_detection_status` reports `'ready'` before every applicable
 * photo has reached a terminal state. Same shape as `displayedAiStatus`: the
 * event-level column and the live per-photo count aren't read atomically, so
 * never trust `'ready'` while photos are still pending — show `'detecting'`
 * until `pending` reaches 0.
 */
export function displayedBibStatus(snapshot: {
  status: BibDetectionEventStatus;
  pending: number;
}): BibDetectionEventStatus {
  if (snapshot.status === 'ready' && snapshot.pending > 0) return 'detecting';
  return snapshot.status;
}

/** True while the worker is making progress and the UI should keep polling. */
export function shouldPollBibStatus(snapshot: {
  status: BibDetectionEventStatus;
  pending: number;
}): boolean {
  if (displayedBibStatus(snapshot) === 'detecting') return true;
  if (snapshot.status === 'idle' && snapshot.pending > 0) return true;
  return false;
}
