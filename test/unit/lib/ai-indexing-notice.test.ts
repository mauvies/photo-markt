/**
 * Regression tests for T-209: a photographer uploaded a photo to an event with
 * AI matching on and the card said "0 of 0 photos indexed".
 *
 * `totalApplicable` skips photos marked `not_applicable`, so two unrelated
 * situations rendered identically: an event with no photos, and an event whose
 * photos the worker had all opted out of (it ran while the event had no usable
 * AI setup — in the staging repro, no Rekognition collection existed yet).
 *
 * Worse, the second one was a dead end: Re-index — the action that re-drives
 * those photos — was greyed out, because the card gated it on `ready`/`failed`.
 *
 * Note what is NOT a case here: "the worker never touched these photos".
 * `photos.face_index_status` is `not null default 'pending'`, so an untouched
 * row counts as applicable and already reads "0 of N".
 */

import { describe, expect, it } from 'vitest';
import {
  canReindexFromNotice,
  resolveAiIndexingNotice,
  shouldPollAiStatus,
} from '@/lib/ai-indexing-status';

describe('resolveAiIndexingNotice (T-209)', () => {
  it('stays quiet when there is a real queue', () => {
    expect(resolveAiIndexingNotice({ totalPhotos: 10, totalApplicable: 10 })).toBe('none');
    // A partially-applicable event still has a queue to report on.
    expect(resolveAiIndexingNotice({ totalPhotos: 10, totalApplicable: 4 })).toBe('none');
  });

  it('says "no photos" for an empty event', () => {
    expect(resolveAiIndexingNotice({ totalPhotos: 0, totalApplicable: 0 })).toBe('no-photos');
  });

  it('says "none applicable" when photos exist but nothing is queued', () => {
    // The staging repro: 69 photos, all `not_applicable`, AI matching enabled.
    expect(resolveAiIndexingNotice({ totalPhotos: 69, totalApplicable: 0 })).toBe(
      'none-applicable',
    );
    expect(resolveAiIndexingNotice({ totalPhotos: 1, totalApplicable: 0 })).toBe('none-applicable');
  });

  it('never confuses the two empty-queue causes', () => {
    // The whole point: these must not render the same line.
    expect(resolveAiIndexingNotice({ totalPhotos: 0, totalApplicable: 0 })).not.toBe(
      resolveAiIndexingNotice({ totalPhotos: 3, totalApplicable: 0 }),
    );
  });
});

describe('canReindexFromNotice (T-209)', () => {
  it('offers re-index where it is the fix', () => {
    expect(canReindexFromNotice('none-applicable')).toBe(true);
  });

  it('does not claim re-index is the fix when there is a queue or no photos', () => {
    expect(canReindexFromNotice('none')).toBe(false);
    expect(canReindexFromNotice('no-photos')).toBe(false);
  });
});

describe('shouldPollAiStatus is unchanged by T-209', () => {
  it('keeps the pre-existing polling rules', () => {
    // A freshly uploaded photo sits at the `pending` default, so it already
    // counts as applicable and the existing idle+pending rule polls it.
    expect(shouldPollAiStatus({ status: 'idle', pending: 1 })).toBe(true);
    expect(shouldPollAiStatus({ status: 'indexing', pending: 5 })).toBe(true);
    expect(shouldPollAiStatus({ status: 'ready', pending: 1 })).toBe(true);
    expect(shouldPollAiStatus({ status: 'ready', pending: 0 })).toBe(false);
    // `none-applicable` is terminal until someone re-indexes — polling it
    // every 5 seconds forever would buy nothing.
    expect(shouldPollAiStatus({ status: 'idle', pending: 0 })).toBe(false);
  });
});
