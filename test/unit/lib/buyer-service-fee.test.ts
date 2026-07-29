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
  it('is dark — the configured amounts are 0, so no buyer is charged a fee', () => {
    // Guards the dark launch: if someone raises these constants, they have to
    // come here and say so deliberately, in a reviewable diff.
    expect(BUYER_SERVICE_FEE_FIXED_CENTS).toBe(0);
    expect(BUYER_SERVICE_FEE_BPS).toBe(0);
    expect(getBuyerServiceFeeCents(1000)).toBe(0);
    expect(getBuyerServiceFeeCents(1)).toBe(0);
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

  it('is dark today — the shipped floor is 0, so no existing price is rejected', () => {
    expect(MIN_PHOTO_PRICE_CENTS).toBe(0);
    expect(isPhotoPriceAboveFloor(1, MIN_PHOTO_PRICE_CENTS)).toBe(true);
  });
});
