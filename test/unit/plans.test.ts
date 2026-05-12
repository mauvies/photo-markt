import { describe, expect, it } from 'vitest';
import {
  formatPlanPrice,
  getPhotographerNetCents,
  getPlanById,
  getPlatformFeeRate,
  PLANS,
  PLATFORM_FEE_RATES,
} from '@/lib/plans';

describe('PLANS catalogue', () => {
  it('has exactly the three documented plans', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['free', 'starter', 'pro']);
  });

  it('marks starter as the popular plan', () => {
    const starter = PLANS.find((p) => p.id === 'starter');
    expect(starter?.popular).toBe(true);
    expect(PLANS.filter((p) => p.popular).length).toBe(1);
  });
});

describe('getPlatformFeeRate', () => {
  it('returns the rate for each known plan', () => {
    expect(getPlatformFeeRate('free')).toBe(PLATFORM_FEE_RATES.free);
    expect(getPlatformFeeRate('starter')).toBe(PLATFORM_FEE_RATES.starter);
    expect(getPlatformFeeRate('pro')).toBe(PLATFORM_FEE_RATES.pro);
  });

  it("falls back to the free plan's fee when planId is unknown / null", () => {
    expect(getPlatformFeeRate(null)).toBe(PLATFORM_FEE_RATES.free);
    expect(getPlatformFeeRate(undefined)).toBe(PLATFORM_FEE_RATES.free);
    expect(getPlatformFeeRate('does-not-exist')).toBe(PLATFORM_FEE_RATES.free);
  });
});

describe('getPhotographerNetCents', () => {
  it('subtracts the platform fee for a known plan', () => {
    // free plan: 15% fee. 1000 cents → 850 cents net.
    expect(getPhotographerNetCents(1000, 'free')).toBe(850);
    // pro plan: 5% fee. 1000 cents → 950 cents net.
    expect(getPhotographerNetCents(1000, 'pro')).toBe(950);
  });

  it('floors fractional cents (no rounding-up favours the platform)', () => {
    // 999 * 0.85 = 849.15 → 849 cents.
    expect(getPhotographerNetCents(999, 'free')).toBe(849);
  });

  it('uses the free-plan fee on unknown plan id', () => {
    expect(getPhotographerNetCents(1000, null)).toBe(getPhotographerNetCents(1000, 'free'));
  });

  it('handles zero correctly', () => {
    expect(getPhotographerNetCents(0, 'pro')).toBe(0);
  });
});

describe('getPlanById', () => {
  it('returns the matching plan', () => {
    expect(getPlanById('starter')?.name).toBe('Starter');
  });

  it('returns undefined for an unknown id at runtime', () => {
    // Type system says PlanId, but real callers may pass strings from the DB.
    expect(getPlanById('amateur' as 'starter')).toBeUndefined();
  });
});

describe('formatPlanPrice', () => {
  it('returns "Free" when the plan has no price', () => {
    expect(formatPlanPrice({ ...getPlanById('free')!, price: null })).toBe('Free');
  });

  it('formats a monthly plan as $X/mo', () => {
    expect(formatPlanPrice(getPlanById('starter')!)).toBe('$14.99/mo');
  });

  it('formats a yearly plan as $X/yr', () => {
    expect(formatPlanPrice({ ...getPlanById('starter')!, priceInterval: 'year' })).toBe(
      '$14.99/yr',
    );
  });
});
