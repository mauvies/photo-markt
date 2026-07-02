import { describe, expect, it } from 'vitest';
import {
  resolveRetryOutcome,
  shouldDiscardCreatedEvent,
} from '@/app/[lang]/dashboard/photographer/events/new/orphan-cleanup';

/**
 * Regression test for T-054: an event created by the wizard was left behind
 * (orphan) whenever the subsequent photo upload failed or was cancelled — the
 * user saw an error, couldn't continue, yet the event showed up later.
 *
 * The wizard now soft-deletes the created event when the flow ends in a
 * hard-stop terminal state with nothing attached. This locks in that policy.
 */
describe('shouldDiscardCreatedEvent', () => {
  it('discards when the upload errored and nothing attached', () => {
    // The exact reported case: signed-URL mint threw → run() threw → stage
    // 'error', zero photos attached.
    expect(shouldDiscardCreatedEvent('error', 0)).toBe(true);
  });

  it('discards when the user cancelled and nothing attached', () => {
    expect(shouldDiscardCreatedEvent('cancelled', 0)).toBe(true);
  });

  it('keeps the event when at least one photo attached, even on error', () => {
    // Partial-attach on the error path still produced real content — deleting
    // it would throw away photos the event legitimately holds.
    expect(shouldDiscardCreatedEvent('error', 3)).toBe(false);
    expect(shouldDiscardCreatedEvent('cancelled', 1)).toBe(false);
  });

  it('keeps the event on success / partial-failed terminal states', () => {
    expect(shouldDiscardCreatedEvent('done', 10)).toBe(false);
    expect(shouldDiscardCreatedEvent('partial-failed', 8)).toBe(false);
    // Even a zero-attached partial-failed (shouldn't happen, but be safe) is
    // not a hard-stop: keep it rather than surprise-delete.
    expect(shouldDiscardCreatedEvent('partial-failed', 0)).toBe(false);
  });

  it('does not discard on non-terminal / idle stages', () => {
    expect(shouldDiscardCreatedEvent('idle', 0)).toBe(false);
    expect(shouldDiscardCreatedEvent('preparing', 0)).toBe(false);
    expect(shouldDiscardCreatedEvent('uploading', 0)).toBe(false);
    expect(shouldDiscardCreatedEvent('finalizing', 0)).toBe(false);
  });
});

/**
 * Regression tests for T-056: after retrying failed photos the wizard didn't
 * navigate to the event. The onRetryFailed handler now uses resolveRetryOutcome
 * to accumulate the attached count and decide whether to navigate.
 */
describe('resolveRetryOutcome', () => {
  it('navigates and sums counts when retry clears all failures (regression: T-056)', () => {
    // All photos failed on first run (attachedCount=0); retry attaches 3,
    // none remain failed.
    const result = resolveRetryOutcome(0, 3, 0);
    expect(result.totalAttached).toBe(3);
    expect(result.shouldNavigate).toBe(true);
  });

  it('accumulates counts from initial run + retry and navigates on full success', () => {
    // Initial run attached 1, retry attaches 2 more, no failures left.
    const result = resolveRetryOutcome(1, 2, 0);
    expect(result.totalAttached).toBe(3);
    expect(result.shouldNavigate).toBe(true);
  });

  it('does not navigate when some photos still failed after retry', () => {
    const result = resolveRetryOutcome(1, 1, 1);
    expect(result.totalAttached).toBe(2);
    expect(result.shouldNavigate).toBe(false);
  });

  it('does not navigate when retry attached nothing and failures remain', () => {
    const result = resolveRetryOutcome(0, 0, 2);
    expect(result.totalAttached).toBe(0);
    expect(result.shouldNavigate).toBe(false);
  });

  it('handles retry that attached nothing but cleared all failures (edge case)', () => {
    // Unlikely but: retry ran, failed list is now empty, nothing new attached.
    const result = resolveRetryOutcome(5, 0, 0);
    expect(result.totalAttached).toBe(5);
    expect(result.shouldNavigate).toBe(true);
  });
});
