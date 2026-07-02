import { describe, expect, it } from 'vitest';
import { shouldDiscardCreatedEvent } from '@/app/[lang]/dashboard/photographer/events/new/orphan-cleanup';

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
