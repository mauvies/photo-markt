import { describe, expect, it } from 'vitest';
import { displayedAiStatus, shouldPollAiStatus } from '@/lib/ai-indexing-status';

describe('displayedAiStatus', () => {
  // Regression (T-058): `ai_matching_status` can report 'ready' before every
  // applicable photo has reached a terminal state — never trust it blindly.
  it('shows "indexing" when the raw status is "ready" but photos are still pending', () => {
    expect(displayedAiStatus({ status: 'ready', pending: 3 })).toBe('indexing');
  });

  it('shows "ready" when the raw status is "ready" and nothing is pending', () => {
    expect(displayedAiStatus({ status: 'ready', pending: 0 })).toBe('ready');
  });

  it('passes through "indexing", "idle", and "failed" unchanged', () => {
    expect(displayedAiStatus({ status: 'indexing', pending: 5 })).toBe('indexing');
    expect(displayedAiStatus({ status: 'idle', pending: 0 })).toBe('idle');
    expect(displayedAiStatus({ status: 'idle', pending: 4 })).toBe('idle');
    expect(displayedAiStatus({ status: 'failed', pending: 0 })).toBe('failed');
  });
});

describe('shouldPollAiStatus', () => {
  it('polls while genuinely indexing', () => {
    expect(shouldPollAiStatus({ status: 'indexing', pending: 5 })).toBe(true);
  });

  it('polls while idle with photos still pending', () => {
    expect(shouldPollAiStatus({ status: 'idle', pending: 2 })).toBe(true);
  });

  // Regression (T-058): previously this returned false, so the card got
  // stuck showing "ready" forever instead of catching up via the next poll.
  it('polls when the raw status is "ready" but photos are still pending', () => {
    expect(shouldPollAiStatus({ status: 'ready', pending: 1 })).toBe(true);
  });

  it('does not poll when genuinely ready, failed, or idle with nothing pending', () => {
    expect(shouldPollAiStatus({ status: 'ready', pending: 0 })).toBe(false);
    expect(shouldPollAiStatus({ status: 'failed', pending: 0 })).toBe(false);
    expect(shouldPollAiStatus({ status: 'idle', pending: 0 })).toBe(false);
  });
});
