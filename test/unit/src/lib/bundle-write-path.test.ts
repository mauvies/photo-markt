import { describe, expect, it } from 'vitest';
import {
  type BundleTier,
  eventAcceptsBundleConfig,
  eventSupportsBundles,
  getBundleDiscountCents,
  getBundlePriceCents,
  parseAllPhotosSubmission,
  parseBundleTiersSubmission,
  validateBundleSchedule,
} from '@/lib/bundle-pricing';
import { MIN_PHOTO_PRICE_CENTS } from '@/lib/plans';

/**
 * T-212 — the WRITE path.
 *
 * T-203 introduced a read/write parser split precisely so a write would never
 * silently discard what a photographer typed. The split was incomplete: the
 * write parser still answered `null` for "I could not parse this", which the
 * actions read as "there is no ladder" and turned into a DELETE — reported as
 * success. These pin the three states apart.
 */

const UNIT = 500;

describe('parseBundleTiersSubmission — absent vs cleared vs invalid', () => {
  it('reports an unsent field as absent, so the column is left alone', () => {
    expect(parseBundleTiersSubmission(undefined)).toEqual({ kind: 'absent' });
    expect(parseBundleTiersSubmission(null)).toEqual({ kind: 'absent' });
  });

  it('reports an emptied field as cleared, which is a real intent to remove', () => {
    expect(parseBundleTiersSubmission('')).toEqual({ kind: 'cleared' });
    expect(parseBundleTiersSubmission('   ')).toEqual({ kind: 'cleared' });
    expect(parseBundleTiersSubmission('[]')).toEqual({ kind: 'cleared' });
  });

  it('reports a cleared TOTAL box as invalid, not as "no ladder"', () => {
    // The editor emits `totalPriceCents: 0` for an emptied amount. This used to
    // parse to null and delete the whole stored ladder while reporting success.
    expect(
      parseBundleTiersSubmission(JSON.stringify([{ minQuantity: 3, totalPriceCents: 0 }])),
    ).toEqual({ kind: 'invalid', error: 'total_not_integer' });
  });

  it('reports a threshold of 1 as invalid, making quantity_too_low reachable', () => {
    expect(
      parseBundleTiersSubmission(JSON.stringify([{ minQuantity: 1, totalPriceCents: 900 }])),
    ).toEqual({ kind: 'invalid', error: 'quantity_too_low' });
  });

  it('reports unparseable JSON as invalid rather than as an empty ladder', () => {
    expect(parseBundleTiersSubmission('not json')).toEqual({
      kind: 'invalid',
      error: 'not_parseable',
    });
    expect(parseBundleTiersSubmission('{"a":1}')).toEqual({
      kind: 'invalid',
      error: 'not_parseable',
    });
  });

  it('reports too many rungs as invalid, naming the rule', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      minQuantity: i + 2,
      totalPriceCents: (i + 1) * 100,
    }));
    expect(parseBundleTiersSubmission(JSON.stringify(many))).toEqual({
      kind: 'invalid',
      error: 'too_many_tiers',
    });
  });

  it('accepts a sound ladder and normalizes its order', () => {
    const submission = parseBundleTiersSubmission(
      JSON.stringify([
        { minQuantity: 8, totalPriceCents: 2000 },
        { minQuantity: 3, totalPriceCents: 1200 },
      ]),
    );
    expect(submission).toEqual({
      kind: 'tiers',
      tiers: [
        { minQuantity: 3, totalPriceCents: 1200 },
        { minQuantity: 8, totalPriceCents: 2000 },
      ],
    });
  });
});

describe('parseAllPhotosSubmission', () => {
  it('separates absent from cleared from a real amount', () => {
    expect(parseAllPhotosSubmission(undefined)).toEqual({ kind: 'absent' });
    expect(parseAllPhotosSubmission('')).toEqual({ kind: 'cleared' });
    expect(parseAllPhotosSubmission('0')).toEqual({ kind: 'cleared' });
    expect(parseAllPhotosSubmission('2500')).toEqual({ kind: 'cents', cents: 2500 });
  });

  it('rejects a negative or unparseable amount instead of clearing', () => {
    expect(parseAllPhotosSubmission('-5')).toMatchObject({ kind: 'invalid' });
    expect(parseAllPhotosSubmission('abc')).toMatchObject({ kind: 'invalid' });
  });
});

describe('eventAcceptsBundleConfig vs eventSupportsBundles', () => {
  const bundled = { type: 'solo', price_per_photo: 5 };

  it('agree while the feature is on', () => {
    expect(eventSupportsBundles(bundled)).toBe(true);
    expect(eventAcceptsBundleConfig(bundled)).toBe(true);
  });

  it('both refuse organizer and free events', () => {
    for (const predicate of [eventSupportsBundles, eventAcceptsBundleConfig]) {
      expect(predicate({ type: 'organizer', price_per_photo: 5 })).toBe(false);
      expect(predicate({ type: 'solo', price_per_photo: null })).toBe(false);
      expect(predicate({ type: 'solo', price_per_photo: 0 })).toBe(false);
    }
  });

  it('the write predicate ignores the kill switch', () => {
    // The rollback switch must stop bundles being READ, never make the write
    // paths think the event may not hold one — that is what turned a rollback
    // into permanent deletion of every stored ladder on the next save.
    // `eventAcceptsBundleConfig` has no reference to it at all.
    const source = eventAcceptsBundleConfig.toString();
    expect(source).not.toContain('BUNDLE_PRICING_ENABLED');
  });
});

describe('getBundleDiscountCents forwards the all-photos ceiling', () => {
  it('reports the discount the ceiling actually produces', () => {
    // 10 × €5 = €50 at list, capped at €20 → a €30 discount. This reported 0
    // before, so a cart would have shown "subtotal €50, discount €0, total €50"
    // for a charge of €20.
    expect(getBundleDiscountCents(10, UNIT, null, 2000)).toBe(3000);
    expect(getBundlePriceCents(10, UNIT, null, 2000)).toBe(2000);
  });

  it('still reports rung discounts, and zero when nothing applies', () => {
    const tiers: BundleTier[] = [{ minQuantity: 3, totalPriceCents: 1200 }];
    expect(getBundleDiscountCents(3, UNIT, tiers)).toBe(300);
    expect(getBundleDiscountCents(2, UNIT, tiers)).toBe(0);
  });
});

/**
 * The property that IS guaranteed — and the one that is NOT.
 *
 * A review flagged that a valid ladder can price a smaller set higher ("3 for
 * €9" charges €10 for two, €9 for three) and called it a monotonicity bug.
 * Enforcing monotonicity would forbid the product's flagship shape: the
 * Foto-Flat rung "40 photos for €19.90" drops from €195 to €19.90. What protects
 * the buyer is the `min` against buying singly, which no configuration can
 * escape.
 */
describe('no configuration can charge more than buying singly', () => {
  const SCHEDULES: Array<{ tiers: BundleTier[] | null; cap: number | null }> = [
    { tiers: [{ minQuantity: 3, totalPriceCents: 1200 }], cap: null },
    { tiers: [{ minQuantity: 3, totalPriceCents: 900 }], cap: null },
    { tiers: [{ minQuantity: 40, totalPriceCents: 1990 }], cap: null },
    { tiers: null, cap: 2000 },
    {
      tiers: [
        { minQuantity: 3, totalPriceCents: 1200 },
        { minQuantity: 8, totalPriceCents: 2000 },
      ],
      cap: 2500,
    },
    { tiers: [{ minQuantity: 10, totalPriceCents: 1800 }], cap: 2000 },
  ];

  it('holds across every schedule shape and quantity', () => {
    for (const { tiers, cap } of SCHEDULES) {
      for (let quantity = 1; quantity <= 60; quantity++) {
        expect(getBundlePriceCents(quantity, UNIT, tiers, cap)).toBeLessThanOrEqual(
          quantity * UNIT,
        );
      }
    }
  });

  it('accepts the steep shapes rather than rejecting them as non-monotonic', () => {
    // "3 for €9" and the Foto-Flat rung both dip below the quantity beneath
    // them. Both are legitimate published discounts and must validate.
    expect(
      validateBundleSchedule(
        [{ minQuantity: 3, totalPriceCents: 900 }],
        UNIT,
        MIN_PHOTO_PRICE_CENTS,
      ).ok,
    ).toBe(true);
    expect(
      validateBundleSchedule(
        [{ minQuantity: 40, totalPriceCents: 1990 }],
        UNIT,
        MIN_PHOTO_PRICE_CENTS,
      ).ok,
    ).toBe(true);
  });
});
