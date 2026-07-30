import { describe, expect, it } from 'vitest';
import {
  allocateBundleTotalCents,
  type BundleTier,
  eventSupportsBundles,
  getBundleDiscountCents,
  getBundlePriceCents,
  getEffectivePerPhotoCents,
  getNextBundleTier,
  MAX_BUNDLE_TIERS,
  parseBundleTiers,
  parseBundleTiersInput,
  serializeBundleTiers,
  validateBundleSchedule,
} from '@/lib/bundle-pricing';
import { MIN_PHOTO_PRICE_CENTS } from '@/lib/plans';

/**
 * The ladder from the T-200 design and the owner's own example:
 * unit €5.00 · 3+ photos €12.00 · 8+ photos €20.00.
 */
const UNIT = 500;
const LADDER: BundleTier[] = [
  { minQuantity: 3, totalPriceCents: 1200 },
  { minQuantity: 8, totalPriceCents: 2000 },
];

describe('getBundlePriceCents', () => {
  it('charges every rung of a three-rung ladder — the 8+ rung is NOT shadowed by the cheaper 3+ rung', () => {
    // This is the regression for the bug the owner's example exposed: taking the
    // `min` across every applicable rung (the first draft of the design) would
    // price 8 and 20 photos at 1200, making the 8+ rung unreachable.
    expect(getBundlePriceCents(1, UNIT, LADDER)).toBe(500);
    expect(getBundlePriceCents(2, UNIT, LADDER)).toBe(1000);
    expect(getBundlePriceCents(3, UNIT, LADDER)).toBe(1200);
    expect(getBundlePriceCents(7, UNIT, LADDER)).toBe(1200);
    expect(getBundlePriceCents(8, UNIT, LADDER)).toBe(2000);
    expect(getBundlePriceCents(20, UNIT, LADDER)).toBe(2000);
  });

  it('leaves quantities below the first threshold undiscounted', () => {
    expect(getBundlePriceCents(2, UNIT, LADDER)).toBe(2 * UNIT);
    expect(getBundleDiscountCents(2, UNIT, LADDER)).toBe(0);
  });

  it('prices at list when the event has no ladder', () => {
    expect(getBundlePriceCents(5, UNIT, null)).toBe(2500);
    expect(getBundlePriceCents(5, UNIT, [])).toBe(2500);
    expect(getBundlePriceCents(5, UNIT, undefined)).toBe(2500);
  });

  it('never charges more than buying the photos singly, even for a misconfigured rung', () => {
    // A rung whose total exceeds `quantity × unit` must be ignored rather than
    // applied — the `min` guard is independent of write-time validation.
    const overpriced: BundleTier[] = [{ minQuantity: 3, totalPriceCents: 9999 }];
    expect(getBundlePriceCents(3, UNIT, overpriced)).toBe(1500);
    expect(getBundlePriceCents(4, UNIT, overpriced)).toBe(2000);
  });

  it('is non-decreasing in quantity across a valid ladder', () => {
    let previous = 0;
    for (let quantity = 1; quantity <= 40; quantity++) {
      const price = getBundlePriceCents(quantity, UNIT, LADDER);
      expect(price).toBeGreaterThanOrEqual(previous);
      previous = price;
    }
  });

  it('does not depend on the stored order of the rungs', () => {
    const reversed = [...LADDER].reverse();
    for (let quantity = 1; quantity <= 20; quantity++) {
      expect(getBundlePriceCents(quantity, UNIT, reversed)).toBe(
        getBundlePriceCents(quantity, UNIT, LADDER),
      );
    }
  });

  it('returns 0 for a non-positive quantity or a free event', () => {
    expect(getBundlePriceCents(0, UNIT, LADDER)).toBe(0);
    expect(getBundlePriceCents(-3, UNIT, LADDER)).toBe(0);
    expect(getBundlePriceCents(5, 0, LADDER)).toBe(0);
    expect(getBundlePriceCents(Number.NaN, UNIT, LADDER)).toBe(0);
  });
});

describe('getBundleDiscountCents', () => {
  it('reports what the ladder takes off this set', () => {
    expect(getBundleDiscountCents(3, UNIT, LADDER)).toBe(1500 - 1200);
    expect(getBundleDiscountCents(8, UNIT, LADDER)).toBe(4000 - 2000);
  });

  it('is zero when no rung applies, so the cart renders its pre-bundle summary', () => {
    expect(getBundleDiscountCents(2, UNIT, LADDER)).toBe(0);
    expect(getBundleDiscountCents(5, UNIT, null)).toBe(0);
  });
});

describe('getNextBundleTier', () => {
  it('returns the lowest threshold the buyer has not reached', () => {
    expect(getNextBundleTier(1, LADDER)).toEqual({ minQuantity: 3, totalPriceCents: 1200 });
    expect(getNextBundleTier(3, LADDER)).toEqual({ minQuantity: 8, totalPriceCents: 2000 });
    expect(getNextBundleTier(7, LADDER)).toEqual({ minQuantity: 8, totalPriceCents: 2000 });
  });

  it('returns null once the top rung is reached, so no prompt is shown', () => {
    expect(getNextBundleTier(8, LADDER)).toBeNull();
    expect(getNextBundleTier(50, LADDER)).toBeNull();
    expect(getNextBundleTier(1, null)).toBeNull();
  });
});

describe('allocateBundleTotalCents', () => {
  it('splits an indivisible total into whole cents that sum exactly', () => {
    const allocated = allocateBundleTotalCents(1000, 3);
    expect(allocated).toEqual([334, 333, 333]);
    expect(allocated.reduce((sum, cents) => sum + cents, 0)).toBe(1000);
  });

  it('sums to the total for every count — no cent invented or lost', () => {
    for (let total = 0; total <= 400; total += 7) {
      for (let count = 1; count <= 12; count++) {
        const allocated = allocateBundleTotalCents(total, count);
        expect(allocated).toHaveLength(count);
        expect(allocated.reduce((sum, cents) => sum + cents, 0)).toBe(total);
        expect(allocated.every((cents) => Number.isInteger(cents) && cents >= 0)).toBe(true);
      }
    }
  });

  it('is deterministic', () => {
    expect(allocateBundleTotalCents(2000, 7)).toEqual(allocateBundleTotalCents(2000, 7));
  });

  it('handles a free or empty set without throwing', () => {
    expect(allocateBundleTotalCents(0, 3)).toEqual([0, 0, 0]);
    expect(allocateBundleTotalCents(1000, 0)).toEqual([]);
  });
});

describe('validateBundleSchedule', () => {
  it('accepts the design ladder', () => {
    expect(validateBundleSchedule(LADDER, UNIT, MIN_PHOTO_PRICE_CENTS).ok).toBe(true);
  });

  it('rejects a ladder whose totals do not increase — the rule that stops a collapse', () => {
    // Without this rule the 8+ rung at 1200 would price every quantity from 3
    // upward below what the photographer intended for the 3+ rung.
    // Unit is €10 here so BOTH rungs are genuine discounts and the only rule
    // this ladder breaks is the increasing-totals one.
    const collapsing: BundleTier[] = [
      { minQuantity: 3, totalPriceCents: 2000 },
      { minQuantity: 8, totalPriceCents: 1200 },
    ];
    expect(validateBundleSchedule(collapsing, 1000, MIN_PHOTO_PRICE_CENTS)).toMatchObject({
      ok: false,
      error: 'total_not_increasing',
    });
  });

  it('rejects a rung that is not actually a discount', () => {
    const notADiscount: BundleTier[] = [{ minQuantity: 5, totalPriceCents: 2500 }];
    expect(validateBundleSchedule(notADiscount, UNIT, MIN_PHOTO_PRICE_CENTS)).toMatchObject({
      ok: false,
      error: 'total_not_a_discount',
    });
  });

  it('applies the floor to the rung TOTAL, not per photo', () => {
    // 40 photos for €19.90 is fine (well above the €1.50 floor as a total) even
    // though €0.50 per photo would be below it — the floor is about what the
    // buyer is buying, which for a bundle is the set.
    const bigBundle: BundleTier[] = [{ minQuantity: 40, totalPriceCents: 1990 }];
    expect(validateBundleSchedule(bigBundle, UNIT, MIN_PHOTO_PRICE_CENTS).ok).toBe(true);

    const belowFloor: BundleTier[] = [{ minQuantity: 3, totalPriceCents: 100 }];
    expect(validateBundleSchedule(belowFloor, UNIT, 150)).toMatchObject({
      ok: false,
      error: 'total_below_floor',
      minCents: 150,
    });
  });

  it('rejects thresholds below 2, non-integers, and non-increasing thresholds', () => {
    expect(
      validateBundleSchedule([{ minQuantity: 1, totalPriceCents: 400 }], UNIT, 150).error,
    ).toBe('quantity_too_low');
    expect(
      validateBundleSchedule([{ minQuantity: 2.5, totalPriceCents: 400 }], UNIT, 150).error,
    ).toBe('quantity_not_integer');
    // Unit €10 so both rungs are genuine discounts and the ordering rule is the
    // only one this ladder breaks.
    expect(
      validateBundleSchedule(
        [
          { minQuantity: 5, totalPriceCents: 1200 },
          { minQuantity: 3, totalPriceCents: 2000 },
        ],
        1000,
        150,
      ).error,
    ).toBe('quantity_not_increasing');
  });

  it('rejects an empty ladder and one past the rung cap', () => {
    expect(validateBundleSchedule([], UNIT, 150).error).toBe('empty');
    const tooMany = Array.from({ length: MAX_BUNDLE_TIERS + 1 }, (_, i) => ({
      minQuantity: i + 2,
      totalPriceCents: 200 + i * 100,
    }));
    expect(validateBundleSchedule(tooMany, 100_000, 150).error).toBe('too_many_tiers');
  });

  it('rejects a non-integer or non-positive total', () => {
    expect(
      validateBundleSchedule([{ minQuantity: 3, totalPriceCents: 1200.5 }], UNIT, 150).error,
    ).toBe('total_not_integer');
    expect(validateBundleSchedule([{ minQuantity: 3, totalPriceCents: 0 }], UNIT, 150).error).toBe(
      'total_not_integer',
    );
  });
});

describe('parseBundleTiers', () => {
  it('parses a stored ladder and normalizes its order', () => {
    expect(parseBundleTiers([...LADDER].reverse())).toEqual(LADDER);
  });

  it('accepts a JSON string as well as an array', () => {
    expect(parseBundleTiers(JSON.stringify(LADDER))).toEqual(LADDER);
  });

  it('accepts snake_case keys, so a hand-written row still reads', () => {
    expect(parseBundleTiers([{ min_quantity: 3, total_price_cents: 1200 }])).toEqual([
      { minQuantity: 3, totalPriceCents: 1200 },
    ]);
  });

  it('fails CLOSED on anything it cannot validate', () => {
    // Failing closed means falling back to `quantity × unit`, which can only
    // overcharge relative to intent (visible, refundable) and never undercharge.
    expect(parseBundleTiers(null)).toBeNull();
    expect(parseBundleTiers(undefined)).toBeNull();
    expect(parseBundleTiers('not json')).toBeNull();
    expect(parseBundleTiers('{}')).toBeNull();
    expect(parseBundleTiers([])).toBeNull();
    expect(parseBundleTiers([{ minQuantity: 3 }])).toBeNull();
    expect(parseBundleTiers([{ minQuantity: 3, totalPriceCents: '1200' }])).toBeNull();
    expect(parseBundleTiers([{ minQuantity: 1, totalPriceCents: 1200 }])).toBeNull();
    expect(parseBundleTiers([{ minQuantity: 3, totalPriceCents: -5 }])).toBeNull();
    expect(parseBundleTiers([null])).toBeNull();
    expect(parseBundleTiers(42)).toBeNull();
  });

  it('fails closed on a duplicated threshold or a collapsing total', () => {
    expect(
      parseBundleTiers([
        { minQuantity: 3, totalPriceCents: 1200 },
        { minQuantity: 3, totalPriceCents: 1400 },
      ]),
    ).toBeNull();
    expect(
      parseBundleTiers([
        { minQuantity: 3, totalPriceCents: 2000 },
        { minQuantity: 8, totalPriceCents: 1200 },
      ]),
    ).toBeNull();
  });

  it('fails closed past the rung cap', () => {
    const tooMany = Array.from({ length: MAX_BUNDLE_TIERS + 1 }, (_, i) => ({
      minQuantity: i + 2,
      totalPriceCents: 200 + i * 100,
    }));
    expect(parseBundleTiers(tooMany)).toBeNull();
  });

  it('is STRICTER than the input parser, and that difference is load-bearing', () => {
    const collapsing = [
      { minQuantity: 3, totalPriceCents: 2000 },
      { minQuantity: 8, totalPriceCents: 1200 },
    ];

    // On a READ, an inconsistent stored ladder is corruption → fail closed.
    expect(parseBundleTiers(collapsing)).toBeNull();

    // On a WRITE, the same input must survive parsing so the validator can name
    // the violation. Failing closed here would silently discard what the
    // photographer typed and report success — they would save a collapsing
    // ladder, be told nothing, and find their pricing gone.
    expect(parseBundleTiersInput(collapsing)).toEqual(collapsing);
    expect(validateBundleSchedule(collapsing, 1000, 150).error).toBe('total_not_increasing');
  });

  it('round-trips through serialize', () => {
    expect(parseBundleTiers(serializeBundleTiers(LADDER))).toEqual(LADDER);
    expect(serializeBundleTiers(null)).toBeNull();
    expect(serializeBundleTiers([])).toBeNull();
  });
});

describe('getEffectivePerPhotoCents', () => {
  it('states what a rung works out to per photo at its own threshold', () => {
    expect(getEffectivePerPhotoCents({ minQuantity: 8, totalPriceCents: 2000 })).toBe(250);
    expect(getEffectivePerPhotoCents({ minQuantity: 3, totalPriceCents: 1200 })).toBe(400);
  });
});

describe('eventSupportsBundles', () => {
  it('allows solo and collaborative priced events', () => {
    expect(eventSupportsBundles({ type: 'solo', price_per_photo: 5 })).toBe(true);
    expect(eventSupportsBundles({ type: 'collaborative', price_per_photo: 5 })).toBe(true);
  });

  it('excludes organizer events — several sellers, and no revenue split to charge against', () => {
    expect(eventSupportsBundles({ type: 'organizer', price_per_photo: 5 })).toBe(false);
  });

  it('excludes free events — there is nothing to discount', () => {
    expect(eventSupportsBundles({ type: 'solo', price_per_photo: null })).toBe(false);
    expect(eventSupportsBundles({ type: 'solo', price_per_photo: 0 })).toBe(false);
  });
});
