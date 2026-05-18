import { describe, expect, it } from 'vitest';
import { getPlanLimitType, isPlanLimitError, PlanLimitError } from '@/lib/plan-limits';

describe('PlanLimitError', () => {
  it('captures all fields and uses the parseable PLAN_LIMIT: prefix', () => {
    const err = new PlanLimitError({
      limitType: 'maxEvents',
      current: 3,
      max: 3,
      planId: 'free',
    });
    expect(err.limitType).toBe('maxEvents');
    expect(err.current).toBe(3);
    expect(err.max).toBe(3);
    expect(err.planId).toBe('free');
    expect(err.name).toBe('PlanLimitError');
    expect(err.message).toBe('PLAN_LIMIT:maxEvents');
  });
});

describe('isPlanLimitError', () => {
  it('matches a real instance', () => {
    const err = new PlanLimitError({
      limitType: 'storage',
      current: 0,
      max: 1,
      planId: 'free',
    });
    expect(isPlanLimitError(err)).toBe(true);
  });

  it('matches a serialized error that only carries .message (client-side)', () => {
    // Simulates what arrives at the client after Next.js strips custom error
    // fields — only `message` survives, but the prefix lets us still detect it.
    const serialized = new Error('PLAN_LIMIT:storage');
    expect(isPlanLimitError(serialized)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isPlanLimitError(new Error('Some other failure'))).toBe(false);
    expect(isPlanLimitError(null)).toBe(false);
    expect(isPlanLimitError(undefined)).toBe(false);
    expect(isPlanLimitError('string')).toBe(false);
  });
});

describe('getPlanLimitType', () => {
  it('reads limitType from the live instance', () => {
    const err = new PlanLimitError({
      limitType: 'maxEvents',
      current: 1,
      max: 1,
      planId: 'starter',
    });
    expect(getPlanLimitType(err)).toBe('maxEvents');
  });

  it('parses limitType from a serialized error', () => {
    expect(getPlanLimitType(new Error('PLAN_LIMIT:storage'))).toBe('storage');
    expect(getPlanLimitType(new Error('PLAN_LIMIT:maxEvents'))).toBe('maxEvents');
  });

  it('returns null when the message has the prefix but an unknown body', () => {
    expect(getPlanLimitType(new Error('PLAN_LIMIT:somethingElse'))).toBeNull();
  });

  it('returns null for non-plan-limit errors', () => {
    expect(getPlanLimitType(new Error('boom'))).toBeNull();
    expect(getPlanLimitType(null)).toBeNull();
  });
});
