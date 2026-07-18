/**
 * Pure helpers for the optimistic photo-delete flow (T-146).
 *
 * The photographer event grid removes photos optimistically: tiles vanish (and
 * the photo count decrements) the instant the delete is confirmed, before the
 * Server Action responds. On failure the exact prior state is restored and a
 * toast reports it. These helpers keep the state-transition logic out of the
 * component so it can be unit-tested without rendering the whole gallery.
 */

/** What `deletePhotoAction` resolves to per photo (T-142 soft-delete flag). */
export interface DeletePhotoResult {
  /** True when the photo was SOLD and therefore soft-deleted (kept for its
   * buyer) rather than hard-removed. It still leaves the owner grid. */
  retained: boolean;
}

export interface DeleteOutcome {
  /** ids the server confirmed (retained or hard-deleted) — stay out of the grid. */
  succeededIds: string[];
  /** ids whose delete threw — roll them back into the grid. */
  failedIds: string[];
  /** How many succeeded photos were retained (sold, kept for their buyer). */
  retainedCount: number;
  /** How many succeeded photos were hard-removed (non-retained). */
  removedCount: number;
}

/**
 * Partition the settled results of the per-photo `deletePhotoAction` calls into
 * succeeded vs failed, and tally how many succeeded were retained (sold). The
 * result index lines up with `ids` because the callers build the promise array
 * in id order via `ids.map(...)`.
 */
export function resolveDeleteOutcome(
  ids: string[],
  results: PromiseSettledResult<DeletePhotoResult>[],
): DeleteOutcome {
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  let retainedCount = 0;

  ids.forEach((id, i) => {
    const result = results[i];
    if (result && result.status === 'fulfilled') {
      succeededIds.push(id);
      if (result.value.retained) retainedCount += 1;
    } else {
      failedIds.push(id);
    }
  });

  return {
    succeededIds,
    failedIds,
    retainedCount,
    removedCount: succeededIds.length - retainedCount,
  };
}

/**
 * The two overlays the grid and the photo count read from. Kept together so
 * they move in lock-step, but they reconcile on DIFFERENT triggers:
 * - `deletedIds` drops tiles from the grid and must PERSIST across a
 *   `router.refresh()` — load-more pages aren't re-seeded by the server, so
 *   clearing it would resurface a deleted tile from a later page.
 * - `pendingDeleteCount` decrements the whole-event count, which the server
 *   DOES reconcile on refresh (via the `totalCount` prop), so it resets to 0
 *   whenever that prop changes to avoid subtracting the same delete twice.
 */
export interface OptimisticDeleteState {
  deletedIds: Set<string>;
  pendingDeleteCount: number;
}

export function initialOptimisticDeleteState(): OptimisticDeleteState {
  return { deletedIds: new Set(), pendingDeleteCount: 0 };
}

/** Optimistically remove `ids`: drop their tiles and decrement the count now. */
export function applyOptimisticDelete(
  state: OptimisticDeleteState,
  ids: string[],
): OptimisticDeleteState {
  if (ids.length === 0) return state;
  const deletedIds = new Set(state.deletedIds);
  for (const id of ids) deletedIds.add(id);
  return { deletedIds, pendingDeleteCount: state.pendingDeleteCount + ids.length };
}

/** Roll back ONLY the photos whose delete failed: restore their tiles and undo
 * their share of the count decrement. Succeeded photos stay removed. */
export function rollbackFailedDeletes(
  state: OptimisticDeleteState,
  failedIds: string[],
): OptimisticDeleteState {
  if (failedIds.length === 0) return state;
  const deletedIds = new Set(state.deletedIds);
  for (const id of failedIds) deletedIds.delete(id);
  return {
    deletedIds,
    pendingDeleteCount: Math.max(0, state.pendingDeleteCount - failedIds.length),
  };
}

/** The count shown in the toolbar / moderation tab: the server total minus the
 * not-yet-reconciled optimistic deletes, floored at 0. */
export function displayedPhotoCount(totalCount: number, pendingDeleteCount: number): number {
  return Math.max(0, totalCount - pendingDeleteCount);
}
