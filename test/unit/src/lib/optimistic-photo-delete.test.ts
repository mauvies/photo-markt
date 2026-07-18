/**
 * T-146 — optimistic photo-delete state logic.
 *
 * The photographer event grid removes photos optimistically: tiles vanish and
 * the photo count decrements the instant the delete is confirmed, before the
 * Server Action responds. On (partial) failure only the failed photos are
 * restored and the count is corrected. These pure helpers drive the shipped
 * component, so exercising them here covers all four DoD behaviors:
 *   - success removes from the grid + decrements the count (no error toast),
 *   - total failure restores everything,
 *   - partial failure restores ONLY the failed ids with the exact count,
 *   - the count follows the grid in both directions.
 */

import { describe, expect, it } from 'vitest';
import {
  applyOptimisticDelete,
  type DeletePhotoResult,
  displayedPhotoCount,
  initialOptimisticDeleteState,
  resolveDeleteOutcome,
  rollbackFailedDeletes,
} from '@/lib/optimistic-photo-delete';

function fulfilled(retained: boolean): PromiseSettledResult<DeletePhotoResult> {
  return { status: 'fulfilled', value: { retained } };
}
function rejected(): PromiseSettledResult<DeletePhotoResult> {
  return { status: 'rejected', reason: new Error('boom') };
}

describe('resolveDeleteOutcome', () => {
  it('marks every id succeeded when all deletes resolve (no retained)', () => {
    const outcome = resolveDeleteOutcome(['a', 'b'], [fulfilled(false), fulfilled(false)]);
    expect(outcome.succeededIds).toEqual(['a', 'b']);
    expect(outcome.failedIds).toEqual([]);
    expect(outcome.retainedCount).toBe(0);
    expect(outcome.removedCount).toBe(2);
  });

  it('tallies retained (sold) photos separately from hard-removed ones', () => {
    // b was sold → soft-deleted (retained) but still leaves the owner grid.
    const outcome = resolveDeleteOutcome(['a', 'b'], [fulfilled(false), fulfilled(true)]);
    expect(outcome.succeededIds).toEqual(['a', 'b']);
    expect(outcome.retainedCount).toBe(1);
    expect(outcome.removedCount).toBe(1);
  });

  it('marks every id failed when all deletes reject', () => {
    const outcome = resolveDeleteOutcome(['a', 'b'], [rejected(), rejected()]);
    expect(outcome.succeededIds).toEqual([]);
    expect(outcome.failedIds).toEqual(['a', 'b']);
    expect(outcome.removedCount).toBe(0);
  });

  it('partitions a partial failure by index (only the failed id is reported)', () => {
    // a + c succeed, b fails — the index alignment with `ids` must hold.
    const outcome = resolveDeleteOutcome(
      ['a', 'b', 'c'],
      [fulfilled(false), rejected(), fulfilled(false)],
    );
    expect(outcome.succeededIds).toEqual(['a', 'c']);
    expect(outcome.failedIds).toEqual(['b']);
    expect(outcome.retainedCount).toBe(0);
    expect(outcome.removedCount).toBe(2);
  });
});

describe('optimistic grid + count overlays', () => {
  it('drops tiles and decrements the count on optimistic delete', () => {
    const state = applyOptimisticDelete(initialOptimisticDeleteState(), ['a', 'b']);
    expect([...state.deletedIds].sort()).toEqual(['a', 'b']);
    expect(state.pendingDeleteCount).toBe(2);
    // Grid and count agree: 2 removed from a 5-photo event → 3 shown.
    expect(displayedPhotoCount(5, state.pendingDeleteCount)).toBe(3);
  });

  it('is a no-op when deleting an empty selection', () => {
    const start = initialOptimisticDeleteState();
    expect(applyOptimisticDelete(start, [])).toBe(start);
  });

  it('restores the exact prior state when the whole batch fails', () => {
    const optimistic = applyOptimisticDelete(initialOptimisticDeleteState(), ['a', 'b']);
    const rolledBack = rollbackFailedDeletes(optimistic, ['a', 'b']);
    expect(rolledBack.deletedIds.size).toBe(0);
    expect(rolledBack.pendingDeleteCount).toBe(0);
    expect(displayedPhotoCount(5, rolledBack.pendingDeleteCount)).toBe(5);
  });

  it('restores ONLY the failed ids on a partial failure (count follows the grid)', () => {
    const optimistic = applyOptimisticDelete(initialOptimisticDeleteState(), ['a', 'b', 'c']);
    // b failed; a + c stay deleted.
    const rolledBack = rollbackFailedDeletes(optimistic, ['b']);
    expect([...rolledBack.deletedIds].sort()).toEqual(['a', 'c']);
    expect(rolledBack.pendingDeleteCount).toBe(2);
    // Count matches the grid: 2 still removed from a 5-photo event → 3 shown.
    expect(displayedPhotoCount(5, rolledBack.pendingDeleteCount)).toBe(3);
  });

  it('keeps deletedIds untouched when nothing failed', () => {
    const optimistic = applyOptimisticDelete(initialOptimisticDeleteState(), ['a']);
    expect(rollbackFailedDeletes(optimistic, [])).toBe(optimistic);
  });

  it('never shows a negative count', () => {
    // Defensive: a stale total lower than the pending deletes floors at 0.
    expect(displayedPhotoCount(1, 3)).toBe(0);
  });
});
