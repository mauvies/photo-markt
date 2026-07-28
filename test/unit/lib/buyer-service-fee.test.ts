import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Billing v2 (T-194/T-195): the buyer service fee and the minimum photo price.
 *
 * Both read env at CALL time (not module load), which is what lets these tests
 * flip the configuration between cases — and, more importantly, what lets
 * `plans.ts` stay importable from client components that render the pricing
 * cards without ever touching a server-only env var.
 */
const envMock = vi.hoisted(() => ({
  BUYER_SERVICE_FEE_FIXED_CENTS: 0,
  BUYER_SERVICE_FEE_BPS: 0,
  MIN_PHOTO_PRICE_CENTS: 0,
}));

vi.mock('@/env.mjs', () => ({ env: envMock }));

import {
  getBuyerServiceFeeCents,
  getMinPhotoPriceCents,
  isPhotoPriceAboveFloor,
} from '@/lib/plans';

/** The provisional production values from the design (€0.30 + 1.5%, floor €1.50). */
function configureProvisional() {
  envMock.BUYER_SERVICE_FEE_FIXED_CENTS = 30;
  envMock.BUYER_SERVICE_FEE_BPS = 150;
  envMock.MIN_PHOTO_PRICE_CENTS = 150;
}

beforeEach(() => {
  envMock.BUYER_SERVICE_FEE_FIXED_CENTS = 0;
  envMock.BUYER_SERVICE_FEE_BPS = 0;
  envMock.MIN_PHOTO_PRICE_CENTS = 0;
});

describe('getBuyerServiceFeeCents', () => {
  it('combines the fixed and percent components', () => {
    configureProvisional();
    // Spec scenario: €10.00 subtotal at 30 + 150bps → 30 + 15 = 45 cents.
    expect(getBuyerServiceFeeCents(1000)).toBe(45);
  });

  it('rounds the percent component deterministically', () => {
    configureProvisional();
    // 199 * 150 / 10000 = 2.985 → 3. The charged and displayed fee must be the
    // same integer, so the rule is a single Math.round, not floor-here /
    // round-there.
    expect(getBuyerServiceFeeCents(199)).toBe(33);
    expect(getBuyerServiceFeeCents(199)).toBe(getBuyerServiceFeeCents(199));
  });

  it('applies the fixed component even when the percent rounds to zero', () => {
    configureProvisional();
    // 1 cent * 150bps = 0.015 → 0; the fixed part still stands.
    expect(getBuyerServiceFeeCents(1)).toBe(30);
  });

  it('supports a fixed-only configuration', () => {
    envMock.BUYER_SERVICE_FEE_FIXED_CENTS = 30;
    envMock.BUYER_SERVICE_FEE_BPS = 0;
    expect(getBuyerServiceFeeCents(5000)).toBe(30);
  });

  it('supports a percent-only configuration', () => {
    envMock.BUYER_SERVICE_FEE_FIXED_CENTS = 0;
    envMock.BUYER_SERVICE_FEE_BPS = 150;
    expect(getBuyerServiceFeeCents(1000)).toBe(15);
  });

  it('returns 0 when both components are 0 — the kill-switch / dark-launch default', () => {
    // This is the whole rollback story: env back to 0 reproduces v1 exactly,
    // with no code revert.
    expect(getBuyerServiceFeeCents(1000)).toBe(0);
    expect(getBuyerServiceFeeCents(1)).toBe(0);
    expect(getBuyerServiceFeeCents(999_999)).toBe(0);
  });

  it('charges no fee on a non-positive subtotal', () => {
    configureProvisional();
    // An empty or free cart produces no charge, so it must not produce a lone
    // fee line item either.
    expect(getBuyerServiceFeeCents(0)).toBe(0);
    expect(getBuyerServiceFeeCents(-100)).toBe(0);
    expect(getBuyerServiceFeeCents(Number.NaN)).toBe(0);
  });

  it('scales linearly with the subtotal', () => {
    configureProvisional();
    expect(getBuyerServiceFeeCents(10_000)).toBe(30 + 150);
  });
});

describe('minimum photo price', () => {
  it('reads the floor from configuration', () => {
    configureProvisional();
    expect(getMinPhotoPriceCents()).toBe(150);
  });

  it('rejects a positive price below the floor', () => {
    configureProvisional();
    expect(isPhotoPriceAboveFloor(50)).toBe(false);
    expect(isPhotoPriceAboveFloor(149)).toBe(false);
  });

  it('accepts a price at or above the floor', () => {
    configureProvisional();
    expect(isPhotoPriceAboveFloor(150)).toBe(true);
    expect(isPhotoPriceAboveFloor(500)).toBe(true);
  });

  it('exempts free events (null / undefined / 0)', () => {
    configureProvisional();
    expect(isPhotoPriceAboveFloor(null)).toBe(true);
    expect(isPhotoPriceAboveFloor(undefined)).toBe(true);
    expect(isPhotoPriceAboveFloor(0)).toBe(true);
  });

  it('accepts any positive price when the floor is 0 (disabled)', () => {
    expect(getMinPhotoPriceCents()).toBe(0);
    expect(isPhotoPriceAboveFloor(1)).toBe(true);
    expect(isPhotoPriceAboveFloor(50)).toBe(true);
  });

  it('honours an explicitly passed floor over the configured one', () => {
    configureProvisional();
    expect(isPhotoPriceAboveFloor(100, 100)).toBe(true);
    expect(isPhotoPriceAboveFloor(100, 200)).toBe(false);
  });
});
