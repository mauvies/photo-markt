import { describe, expect, it } from 'vitest';
import {
  displayedBibStatus,
  shouldPollBibStatus,
  summarizeBibDetectionProgress,
} from '@/lib/bib-detection-status';

describe('summarizeBibDetectionProgress', () => {
  it('counts processed (detected + no_bibs), pending, failed and with-bibs', () => {
    const result = summarizeBibDetectionProgress([
      'detected',
      'detected',
      'no_bibs',
      'pending',
      'detecting',
      'failed',
    ]);
    expect(result).toEqual({
      totalApplicable: 6,
      processed: 3, // 2 detected + 1 no_bibs
      pending: 2, // pending + detecting
      failed: 1,
      withBibs: 2, // only the `detected` photos carry bibs
    });
  });

  it('excludes NULL ("never ran") and not_applicable from the applicable total', () => {
    const result = summarizeBibDetectionProgress([null, 'not_applicable', 'detected', 'no_bibs']);
    expect(result.totalApplicable).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.pending).toBe(0);
    expect(result.withBibs).toBe(1);
  });

  it('returns all-zero counts for an empty or entirely-inapplicable event', () => {
    expect(summarizeBibDetectionProgress([])).toEqual({
      totalApplicable: 0,
      processed: 0,
      pending: 0,
      failed: 0,
      withBibs: 0,
    });
    expect(summarizeBibDetectionProgress([null, null, 'not_applicable']).totalApplicable).toBe(0);
  });
});

describe('displayedBibStatus', () => {
  // Parity with displayedAiStatus (T-058): the event-level column can report
  // 'ready' before every applicable photo has reached a terminal state — never
  // trust it blindly.
  it('shows "detecting" when the raw status is "ready" but photos are still pending', () => {
    expect(displayedBibStatus({ status: 'ready', pending: 3 })).toBe('detecting');
  });

  it('shows "ready" when the raw status is "ready" and nothing is pending', () => {
    expect(displayedBibStatus({ status: 'ready', pending: 0 })).toBe('ready');
  });

  it('passes through "detecting", "idle", and "failed" unchanged', () => {
    expect(displayedBibStatus({ status: 'detecting', pending: 5 })).toBe('detecting');
    expect(displayedBibStatus({ status: 'idle', pending: 0 })).toBe('idle');
    expect(displayedBibStatus({ status: 'idle', pending: 4 })).toBe('idle');
    expect(displayedBibStatus({ status: 'failed', pending: 0 })).toBe('failed');
  });
});

describe('shouldPollBibStatus', () => {
  it('polls while genuinely detecting', () => {
    expect(shouldPollBibStatus({ status: 'detecting', pending: 5 })).toBe(true);
  });

  it('polls while idle with photos still pending (backfill just enqueued)', () => {
    expect(shouldPollBibStatus({ status: 'idle', pending: 2 })).toBe(true);
  });

  it('polls when the raw status is "ready" but photos are still pending', () => {
    expect(shouldPollBibStatus({ status: 'ready', pending: 1 })).toBe(true);
  });

  it('does not poll when genuinely ready, failed, or idle with nothing pending', () => {
    expect(shouldPollBibStatus({ status: 'ready', pending: 0 })).toBe(false);
    expect(shouldPollBibStatus({ status: 'failed', pending: 0 })).toBe(false);
    expect(shouldPollBibStatus({ status: 'idle', pending: 0 })).toBe(false);
  });
});
