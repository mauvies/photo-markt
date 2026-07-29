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
  it('subtracts the platform fee for a known plan (billing v2 rates)', () => {
    // free plan: 8% fee. 1000 cents → 920 cents net.
    expect(getPhotographerNetCents(1000, 'free')).toBe(920);
    // starter plan: 4% fee. 1000 cents → 960 cents net.
    expect(getPhotographerNetCents(1000, 'starter')).toBe(960);
    // pro plan: 0% fee (T-194) — the photographer keeps the whole price, and
    // the buyer service fee is what covers Stripe on that sale.
    expect(getPhotographerNetCents(1000, 'pro')).toBe(1000);
  });

  it('floors fractional cents (no rounding-up favours the platform)', () => {
    // 999 * 0.92 = 919.08 → 919 cents.
    expect(getPhotographerNetCents(999, 'free')).toBe(919);
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
  it('returns "Free" when the plan has no pricing', () => {
    expect(formatPlanPrice(getPlanById('free')!)).toBe('Free');
  });

  it('formats a monthly plan as €X/mo (T-193; Starter repriced in T-195)', () => {
    expect(formatPlanPrice(getPlanById('starter')!)).toBe('€9.99/mo');
    expect(formatPlanPrice(getPlanById('starter')!, 'monthly')).toBe('€9.99/mo');
  });

  it('formats a yearly plan as the per-month equivalent (€X/mo)', () => {
    // Yearly billing shows the per-month-equivalent on cards. The full
    // "billed yearly" lump-sum is rendered as a subtitle by the UI, not
    // by this helper.
    expect(formatPlanPrice(getPlanById('starter')!, 'yearly')).toBe('€7.99/mo');
    expect(formatPlanPrice(getPlanById('pro')!, 'yearly')).toBe('€23.99/mo');
  });

  it('keeps the Starter yearly lump sum consistent with its per-month figure', () => {
    // 95.88 / 12 = 7.99 — the card would otherwise advertise a discount that
    // Stripe does not actually charge.
    const starter = getPlanById('starter')!;
    expect(starter.pricing?.yearlyTotal).toBe(95.88);
    expect(starter.pricing?.yearlyMonthlyEquivalent).toBeCloseTo(
      (starter.pricing?.yearlyTotal ?? 0) / 12,
      2,
    );
  });
});
