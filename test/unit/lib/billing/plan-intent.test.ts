/**
 * Unit tests for the plan-intent validation chokepoint
 * (`src/lib/billing/plan-intent.ts`).
 *
 * This is the security boundary for T-148: a plan/period pair arriving from the
 * `?plan=` query string or the OAuth state cookie must be whitelisted against
 * `plans.ts`, and the resume target must always be an INTERNAL path — never an
 * arbitrary URL smuggled from client input, and never a client-chosen price.
 */

import { describe, expect, it } from 'vitest';
import {
  isPaidPlan,
  PHOTOGRAPHER_OVERVIEW_PATH,
  PLAN_INTENT_RESUME_ROUTE,
  parsePlanIntent,
  planIntentResumePath,
} from '@/lib/billing/plan-intent';

describe('parsePlanIntent — whitelist', () => {
  it('accepts the three real plan ids', () => {
    expect(parsePlanIntent('free', 'monthly')).toEqual({ plan: 'free', period: 'monthly' });
    expect(parsePlanIntent('starter', 'monthly')).toEqual({ plan: 'starter', period: 'monthly' });
    expect(parsePlanIntent('pro', 'yearly')).toEqual({ plan: 'pro', period: 'yearly' });
  });

  it('rejects unknown / malicious plan values (returns null, no intent)', () => {
    expect(parsePlanIntent('enterprise', 'monthly')).toBeNull();
    expect(parsePlanIntent('//evil.com', 'monthly')).toBeNull();
    expect(parsePlanIntent('https://evil.com/checkout', 'monthly')).toBeNull();
    expect(parsePlanIntent('', 'monthly')).toBeNull();
    expect(parsePlanIntent(null, 'monthly')).toBeNull();
    expect(parsePlanIntent(undefined, undefined)).toBeNull();
  });

  it('defaults an unknown/missing period to monthly and only honors yearly explicitly', () => {
    expect(parsePlanIntent('starter', undefined)?.period).toBe('monthly');
    expect(parsePlanIntent('starter', null)?.period).toBe('monthly');
    expect(parsePlanIntent('starter', 'garbage')?.period).toBe('monthly');
    expect(parsePlanIntent('starter', 'yearly')?.period).toBe('yearly');
  });
});

describe('isPaidPlan', () => {
  it('is false for Free (pricing === null) and true for paid tiers', () => {
    expect(isPaidPlan('free')).toBe(false);
    expect(isPaidPlan('starter')).toBe(true);
    expect(isPaidPlan('pro')).toBe(true);
  });
});

describe('planIntentResumePath — internal only', () => {
  it('sends Free to the overview with no checkout route', () => {
    expect(planIntentResumePath({ plan: 'free', period: 'monthly' })).toBe(
      PHOTOGRAPHER_OVERVIEW_PATH,
    );
  });

  it('sends a paid intent to the internal resume route carrying the whitelisted pair', () => {
    const path = planIntentResumePath({ plan: 'starter', period: 'yearly' });
    expect(path).toBe(`${PLAN_INTENT_RESUME_ROUTE}?plan=starter&period=yearly`);
  });

  it('never returns an absolute/external URL', () => {
    for (const plan of ['free', 'starter', 'pro'] as const) {
      for (const period of ['monthly', 'yearly'] as const) {
        const path = planIntentResumePath({ plan, period });
        expect(path.startsWith('/')).toBe(true);
        expect(path).not.toMatch(/^https?:/);
        expect(path).not.toMatch(/^\/\//);
      }
    }
  });
});
