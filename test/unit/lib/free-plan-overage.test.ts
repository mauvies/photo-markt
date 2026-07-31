/**
 * Unit tests for `getFreePlanOverage` (T-214).
 *
 * This decides whether the cancellation confirmation must warn that dropping to
 * Free will BLOCK further uploads / event creation. It never implies deletion:
 * Free's limits are write-time gates only, so an over-limit photographer keeps
 * everything they have.
 *
 * The boundary is the point of the test: exactly AT a limit is not over it.
 */

import { describe, expect, it } from 'vitest';
import { getFreePlanOverage } from '@/lib/plan-limits';
import { getPlanById } from '@/lib/plans';

const free = getPlanById('free');
// Read from PLANS rather than hardcoded, so the test tracks the same source the
// helper does — if Free's caps change, this test changes with it, not against it.
const STORAGE_LIMIT_GB = free?.storageGB as number;
const EVENTS_LIMIT = free?.maxEvents as number;

describe('getFreePlanOverage', () => {
  it('reports no overage for usage well within Free', () => {
    expect(getFreePlanOverage({ storageUsedGB: 1, eventsCount: 1 })).toEqual({
      storage: false,
      events: false,
    });
  });

  it('treats exactly at the limit as NOT over', () => {
    expect(
      getFreePlanOverage({ storageUsedGB: STORAGE_LIMIT_GB, eventsCount: EVENTS_LIMIT }),
    ).toEqual({ storage: false, events: false });
  });

  it('flags storage once usage passes the Free cap', () => {
    const result = getFreePlanOverage({
      storageUsedGB: STORAGE_LIMIT_GB + 0.01,
      eventsCount: 0,
    });
    expect(result.storage).toBe(true);
    expect(result.events).toBe(false);
  });

  it('flags events once the count passes the Free cap', () => {
    const result = getFreePlanOverage({ storageUsedGB: 0, eventsCount: EVENTS_LIMIT + 1 });
    expect(result.events).toBe(true);
    expect(result.storage).toBe(false);
  });

  it('flags both dimensions independently', () => {
    expect(
      getFreePlanOverage({
        storageUsedGB: STORAGE_LIMIT_GB * 10,
        eventsCount: EVENTS_LIMIT * 10,
      }),
    ).toEqual({ storage: true, events: true });
  });

  it('handles zero usage', () => {
    expect(getFreePlanOverage({ storageUsedGB: 0, eventsCount: 0 })).toEqual({
      storage: false,
      events: false,
    });
  });
});
