import { describe, expect, it } from 'vitest';
import {
  AWS_CALLS_PER_FACE_SEARCH,
  alertClaimKey,
  eventDailyKey,
  FACE_SEARCH_DAILY_WINDOW_SEC,
  getFaceSearchLimits,
  globalDailyKey,
  shouldAlertAtFiftyPercent,
} from '@/lib/face-search-limits';

describe('AWS_CALLS_PER_FACE_SEARCH', () => {
  it('is 1 — one billable SearchFacesByImage op per search, no separate DetectFaces', () => {
    // Pinned deliberately: our search issues exactly one billable Rekognition
    // call. If a second billable call is ever added, this constant (and this
    // expectation) is the single place that changes.
    expect(AWS_CALLS_PER_FACE_SEARCH).toBe(1);
  });
});

describe('FACE_SEARCH_DAILY_WINDOW_SEC', () => {
  it('is a 24h window', () => {
    expect(FACE_SEARCH_DAILY_WINDOW_SEC).toBe(86_400);
  });
});

describe('key builders', () => {
  it('eventDailyKey is namespaced and keyed on the event id', () => {
    expect(eventDailyKey('evt-123')).toBe('face-search-event-day:evt-123');
  });

  it('globalDailyKey is a stable single bucket', () => {
    expect(globalDailyKey()).toBe('face-search-global-day');
  });

  it('alertClaimKey is namespaced per day-window', () => {
    expect(alertClaimKey('2026-07-16T00:00:00.000Z')).toBe(
      'face-search-alert:global-50:2026-07-16T00:00:00.000Z',
    );
  });

  it('the three key prefixes are distinct so buckets never collide', () => {
    const keys = [eventDailyKey('x'), globalDailyKey(), alertClaimKey('w')];
    expect(new Set(keys).size).toBe(3);
    // And distinct from the tier-1 throttle prefix `face-search:` (no `-`/`:`
    // ambiguity: event-day/global-day/alert use different segments).
    expect(keys.every((k) => !k.startsWith('face-search:'))).toBe(true);
  });
});

describe('shouldAlertAtFiftyPercent', () => {
  it('true once count reaches ceil(cap/2)', () => {
    expect(shouldAlertAtFiftyPercent(1000, 2000)).toBe(true);
    expect(shouldAlertAtFiftyPercent(999, 2000)).toBe(false);
  });

  it('rounds the threshold up for odd caps', () => {
    // ceil(9/2) = 5
    expect(shouldAlertAtFiftyPercent(4, 9)).toBe(false);
    expect(shouldAlertAtFiftyPercent(5, 9)).toBe(true);
  });

  it('stays true well past 50% (claim bucket handles the once-per-window dedup)', () => {
    expect(shouldAlertAtFiftyPercent(1999, 2000)).toBe(true);
  });

  it('never alerts for a non-positive cap', () => {
    expect(shouldAlertAtFiftyPercent(5, 0)).toBe(false);
    expect(shouldAlertAtFiftyPercent(5, -1)).toBe(false);
  });
});

describe('getFaceSearchLimits', () => {
  it('reads the env-configured caps (test defaults) and no alert recipient', () => {
    const limits = getFaceSearchLimits();
    expect(limits.globalDailyCalls).toBe(2000);
    expect(limits.eventDailyCalls).toBe(1000);
    // FACE_SEARCH_ALERT_EMAIL is unset in the test env → alerting is a no-op.
    expect(limits.alertEmail).toBeUndefined();
    // Caps are positive integers so a search can always consume at least one.
    expect(Number.isInteger(limits.globalDailyCalls)).toBe(true);
    expect(limits.globalDailyCalls).toBeGreaterThan(0);
  });
});
