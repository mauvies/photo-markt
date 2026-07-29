import { describe, expect, it } from 'vitest';
import {
  BUYER_SERVICE_FEE_BPS,
  BUYER_SERVICE_FEE_FIXED_CENTS,
  computeBuyerServiceFeeCents,
  getBuyerServiceFeeCents,
  isPhotoPriceAboveFloor,
  MIN_PHOTO_PRICE_CENTS,
} from '@/lib/plans';

/**
 * Billing v2 (T-194/T-195): the buyer service fee and the minimum photo price.
 *
 * The configured amounts are plain constants, so these tests split in two:
 * `computeBuyerServiceFeeCents` exercises the arithmetic at values we have not
 * shipped yet, while `getBuyerServiceFeeCents` pins what the app actually
 * charges today.
 */

/** The provisional production values from the design (€0.30 + 1.5%, floor €1.50). */
const PROVISIONAL_FIXED = 30;
const PROVISIONAL_BPS = 150;
const PROVISIONAL_FLOOR = 150;

describe('computeBuyerServiceFeeCents', () => {
  it('combines the fixed and percent components', () => {
    // Spec scenario: €10.00 subtotal at 30 + 150bps → 30 + 15 = 45 cents.
    expect(computeBuyerServiceFeeCents(1000, PROVISIONAL_FIXED, PROVISIONAL_BPS)).toBe(45);
  });

  it('rounds the percent component deterministically', () => {
    // 199 * 150 / 10000 = 2.985 → 3. The charged and displayed fee must be the
    // same integer, so the rule is a single Math.round, not floor-here /
    // round-there.
    expect(computeBuyerServiceFeeCents(199, PROVISIONAL_FIXED, PROVISIONAL_BPS)).toBe(33);
    expect(computeBuyerServiceFeeCents(199, PROVISIONAL_FIXED, PROVISIONAL_BPS)).toBe(
      computeBuyerServiceFeeCents(199, PROVISIONAL_FIXED, PROVISIONAL_BPS),
    );
  });

  it('applies the fixed component even when the percent rounds to zero', () => {
    // 1 cent * 150bps = 0.015 → 0; the fixed part still stands.
    expect(computeBuyerServiceFeeCents(1, PROVISIONAL_FIXED, PROVISIONAL_BPS)).toBe(30);
  });

  it('supports a fixed-only configuration', () => {
    expect(computeBuyerServiceFeeCents(5000, 30, 0)).toBe(30);
  });

  it('supports a percent-only configuration', () => {
    expect(computeBuyerServiceFeeCents(1000, 0, 150)).toBe(15);
  });

  it('returns 0 when both components are 0 — the kill-switch', () => {
    // This is the whole rollback story: amounts back to 0 reproduce v1 exactly.
    expect(computeBuyerServiceFeeCents(1000, 0, 0)).toBe(0);
    expect(computeBuyerServiceFeeCents(1, 0, 0)).toBe(0);
    expect(computeBuyerServiceFeeCents(999_999, 0, 0)).toBe(0);
  });

  it('charges no fee on a non-positive or non-finite subtotal', () => {
    // An empty or free cart produces no charge, so it must not produce a lone
    // fee line item either.
    expect(computeBuyerServiceFeeCents(0, PROVISIONAL_FIXED, PROVISIONAL_BPS)).toBe(0);
    expect(computeBuyerServiceFeeCents(-100, PROVISIONAL_FIXED, PROVISIONAL_BPS)).toBe(0);
    expect(computeBuyerServiceFeeCents(Number.NaN, PROVISIONAL_FIXED, PROVISIONAL_BPS)).toBe(0);
  });

  it('scales linearly with the subtotal', () => {
    expect(computeBuyerServiceFeeCents(10_000, PROVISIONAL_FIXED, PROVISIONAL_BPS)).toBe(30 + 150);
  });
});

describe('getBuyerServiceFeeCents (what ships today)', () => {
  it('charges the configured €0.25 + 3% (T-199)', () => {
    // Pins what every buyer is actually charged. Changing it means coming here
    // and saying so deliberately, in a reviewable diff.
    expect(BUYER_SERVICE_FEE_FIXED_CENTS).toBe(25);
    expect(BUYER_SERVICE_FEE_BPS).toBe(300);
  });

  it('produces the fee amounts the pricing decision was made on', () => {
    // The worked examples behind the choice — a Pro sale is the binding case,
    // since there the fee is the only thing covering Stripe.
    expect(getBuyerServiceFeeCents(100)).toBe(28); // €1.00 photo  → €0.28
    expect(getBuyerServiceFeeCents(500)).toBe(40); // €5.00 photo  → €0.40
    expect(getBuyerServiceFeeCents(1000)).toBe(55); // €10.00 photo → €0.55
    expect(getBuyerServiceFeeCents(5000)).toBe(175); // €50.00 photo → €1.75
  });

  it('still charges nothing on an empty or free cart', () => {
    expect(getBuyerServiceFeeCents(0)).toBe(0);
    expect(getBuyerServiceFeeCents(-1)).toBe(0);
  });

  it('grows with the subtotal but never faster than the configured percent', () => {
    // Guards against a future edit that makes the fee superlinear.
    const perCentOfSubtotal = (subtotal: number) =>
      (getBuyerServiceFeeCents(subtotal) - BUYER_SERVICE_FEE_FIXED_CENTS) / subtotal;
    for (const subtotal of [100, 1000, 10_000, 100_000]) {
      expect(perCentOfSubtotal(subtotal)).toBeCloseTo(BUYER_SERVICE_FEE_BPS / 10_000, 4);
    }
  });

  it('binds the configured amounts to the kernel', () => {
    for (const subtotal of [1, 199, 1000, 12_345]) {
      expect(getBuyerServiceFeeCents(subtotal)).toBe(
        computeBuyerServiceFeeCents(subtotal, BUYER_SERVICE_FEE_FIXED_CENTS, BUYER_SERVICE_FEE_BPS),
      );
    }
  });
});

describe('isPhotoPriceAboveFloor', () => {
  it('rejects a positive price below the floor', () => {
    expect(isPhotoPriceAboveFloor(50, PROVISIONAL_FLOOR)).toBe(false);
    expect(isPhotoPriceAboveFloor(149, PROVISIONAL_FLOOR)).toBe(false);
  });

  it('accepts a price at or above the floor', () => {
    expect(isPhotoPriceAboveFloor(150, PROVISIONAL_FLOOR)).toBe(true);
    expect(isPhotoPriceAboveFloor(500, PROVISIONAL_FLOOR)).toBe(true);
  });

  it('exempts free events (null / undefined / 0)', () => {
    expect(isPhotoPriceAboveFloor(null, PROVISIONAL_FLOOR)).toBe(true);
    expect(isPhotoPriceAboveFloor(undefined, PROVISIONAL_FLOOR)).toBe(true);
    expect(isPhotoPriceAboveFloor(0, PROVISIONAL_FLOOR)).toBe(true);
  });

  it('accepts any positive price when the floor is 0 (disabled)', () => {
    expect(isPhotoPriceAboveFloor(1, 0)).toBe(true);
    expect(isPhotoPriceAboveFloor(50, 0)).toBe(true);
  });

  it('enforces the shipped €1.50 floor (T-199)', () => {
    expect(MIN_PHOTO_PRICE_CENTS).toBe(150);
    expect(isPhotoPriceAboveFloor(149, MIN_PHOTO_PRICE_CENTS)).toBe(false);
    expect(isPhotoPriceAboveFloor(150, MIN_PHOTO_PRICE_CENTS)).toBe(true);
    // Free events stay exempt at any floor.
    expect(isPhotoPriceAboveFloor(null, MIN_PHOTO_PRICE_CENTS)).toBe(true);
    expect(isPhotoPriceAboveFloor(0, MIN_PHOTO_PRICE_CENTS)).toBe(true);
  });

  it('keeps the fee proportionate at the floor', () => {
    // The floor exists so the fee is never a silly fraction of the price: at
    // €1.50 the fee is €0.30, i.e. 20% — the ceiling we were willing to show.
    const feeAtFloor = getBuyerServiceFeeCents(MIN_PHOTO_PRICE_CENTS);
    expect(feeAtFloor / MIN_PHOTO_PRICE_CENTS).toBeLessThanOrEqual(0.2);
  });
});
