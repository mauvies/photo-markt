import { describe, expect, it } from 'vitest';
import type { BundleTier } from '@/lib/bundle-pricing';
import { type BundleCartLine, priceCartWithBundles } from '@/lib/cart-bundle-pricing';

/**
 * T-204 — the cart-level half of bundle pricing: grouping by
 * `(event, photographer)`, pricing each group through the kernel, and allocating
 * the discounted total back onto the photos so `order_items` (and therefore the
 * photographer transfer) never carries a list price against a discounted charge.
 */

/** The user's three-rung ladder from the T-200 design: €5 · 3+ €12 · 8+ €20. */
const LADDER: BundleTier[] = [
  { minQuantity: 3, totalPriceCents: 1200 },
  { minQuantity: 8, totalPriceCents: 2000 },
];

const UNIT = 500;

function line(overrides: Partial<BundleCartLine> & { photoId: string }): BundleCartLine {
  return {
    eventId: 'event-1',
    photographerId: 'photog-1',
    unitPriceCents: UNIT,
    eventName: 'Trail Race',
    bundleTiers: LADDER,
    bundleAllPhotosCents: null,
    bundleEligible: true,
    ...overrides,
  };
}

function lines(count: number, overrides: Partial<BundleCartLine> = {}): BundleCartLine[] {
  return Array.from({ length: count }, (_, i) => line({ photoId: `p${i}`, ...overrides }));
}

describe('priceCartWithBundles — group pricing', () => {
  it('charges list price below the first threshold', () => {
    const priced = priceCartWithBundles(lines(2));
    expect(priced.listSubtotalCents).toBe(1000);
    expect(priced.subtotalCents).toBe(1000);
    expect(priced.discountCents).toBe(0);
  });

  it('charges the rung total once its threshold is reached', () => {
    const priced = priceCartWithBundles(lines(3));
    expect(priced.listSubtotalCents).toBe(1500);
    expect(priced.subtotalCents).toBe(1200);
    expect(priced.discountCents).toBe(300);
  });

  it('does not let a cheap low rung shadow a higher one', () => {
    // 8 photos must charge the 8+ rung (€20), never the 3+ rung (€12).
    const priced = priceCartWithBundles(lines(8));
    expect(priced.subtotalCents).toBe(2000);
  });

  it('never charges more than buying the photos singly', () => {
    for (let n = 1; n <= 12; n++) {
      const priced = priceCartWithBundles(lines(n));
      expect(priced.subtotalCents).toBeLessThanOrEqual(n * UNIT);
    }
  });

  it('is non-decreasing in quantity', () => {
    let previous = 0;
    for (let n = 1; n <= 20; n++) {
      const priced = priceCartWithBundles(lines(n));
      expect(priced.subtotalCents).toBeGreaterThanOrEqual(previous);
      previous = priced.subtotalCents;
    }
  });

  it('applies the "all photos" ceiling as a cap on top of the rungs', () => {
    const priced = priceCartWithBundles(
      lines(20, { bundleTiers: LADDER, bundleAllPhotosCents: 2500 }),
    );
    expect(priced.subtotalCents).toBe(2000); // the 8+ rung is still cheaper
    const capped = priceCartWithBundles(
      lines(20, { bundleTiers: null, bundleAllPhotosCents: 2500 }),
    );
    expect(capped.subtotalCents).toBe(2500);
  });
});

describe('priceCartWithBundles — allocation', () => {
  it('allocates a discounted total to exactly the total', () => {
    const priced = priceCartWithBundles(lines(3));
    const sum = Object.values(priced.allocations).reduce((a, b) => a + b, 0);
    expect(sum).toBe(priced.subtotalCents);
    expect(sum).toBe(1200);
    expect(Object.values(priced.allocations).sort()).toEqual([400, 400, 400]);
  });

  it('splits an indivisible total exactly, giving the remainder to the earliest photos', () => {
    // 7 photos reaches the 3+ rung but not the 8+ one, so the group costs €12.
    const priced = priceCartWithBundles(lines(7));
    expect(priced.subtotalCents).toBe(1200);
    const values = lines(7).map((l) => priced.allocations[l.photoId]);
    expect(values.reduce((a, b) => a + b, 0)).toBe(1200);
    // 1200 / 7 = 171.43 → three at 172, four at 171 (3×172 + 4×171 = 1200).
    expect(values.filter((v) => v === 172)).toHaveLength(3);
    expect(values.filter((v) => v === 171)).toHaveLength(4);
  });

  it('keeps each photo at its own list price when no discount applies', () => {
    const undiscounted = [
      line({ photoId: 'a', unitPriceCents: 500 }),
      line({ photoId: 'b', unitPriceCents: 500 }),
    ];
    const priced = priceCartWithBundles(undiscounted);
    expect(priced.allocations).toEqual({ a: 500, b: 500 });
  });

  it('is deterministic across calls', () => {
    const first = priceCartWithBundles(lines(7));
    const second = priceCartWithBundles(lines(7));
    expect(first.allocations).toEqual(second.allocations);
  });
});

describe('priceCartWithBundles — grouping', () => {
  it('discounts only the qualifying group in a cart spanning two events', () => {
    const cart = [
      ...lines(3),
      ...lines(1).map((l) => ({ ...l, photoId: 'other-1', eventId: 'event-2' })),
    ];
    const priced = priceCartWithBundles(cart);
    // Event 1: 3 photos → €12 (from €15). Event 2: 1 photo → €5, untouched.
    expect(priced.listSubtotalCents).toBe(2000);
    expect(priced.subtotalCents).toBe(1700);
    expect(priced.allocations['other-1']).toBe(500);
    expect(priced.groups).toHaveLength(2);
  });

  it('does not pool two photographers at the same event', () => {
    const cart = [
      line({ photoId: 'a' }),
      line({ photoId: 'b' }),
      line({ photoId: 'c', photographerId: 'photog-2' }),
    ];
    const priced = priceCartWithBundles(cart);
    // Two photos for photographer 1 and one for photographer 2 — neither group
    // reaches the 3-photo rung, so nothing is discounted.
    expect(priced.discountCents).toBe(0);
    expect(priced.groups).toHaveLength(2);
  });

  it('charges list price for an ineligible event even with a stored ladder', () => {
    const priced = priceCartWithBundles(lines(4, { bundleEligible: false }));
    expect(priced.subtotalCents).toBe(2000);
    expect(priced.discountCents).toBe(0);
  });

  it('fails closed to list price when a group disagrees on the unit price', () => {
    const cart = [
      line({ photoId: 'a', unitPriceCents: 500 }),
      line({ photoId: 'b', unitPriceCents: 500 }),
      line({ photoId: 'c', unitPriceCents: 700 }),
    ];
    const priced = priceCartWithBundles(cart);
    expect(priced.subtotalCents).toBe(1700);
    expect(priced.discountCents).toBe(0);
  });

  it('prices a line with no event at list, on its own', () => {
    const priced = priceCartWithBundles([line({ photoId: 'orphan', eventId: null }), ...lines(3)]);
    expect(priced.allocations.orphan).toBe(500);
    expect(priced.subtotalCents).toBe(500 + 1200);
  });

  it('returns an empty, zeroed result for an empty cart', () => {
    const priced = priceCartWithBundles([]);
    expect(priced).toMatchObject({
      listSubtotalCents: 0,
      subtotalCents: 0,
      discountCents: 0,
      groups: [],
      nextTier: null,
    });
  });
});

describe('priceCartWithBundles — next-rung prompt', () => {
  it('names the next rung, how many more photos, and the resulting total', () => {
    const priced = priceCartWithBundles(lines(2));
    expect(priced.nextTier).toMatchObject({
      eventId: 'event-1',
      eventName: 'Trail Race',
      minQuantity: 3,
      photosNeeded: 1,
      resultingTotalCents: 1200,
      currentTotalCents: 1000,
    });
  });

  it('advances to the higher rung once the lower one is reached', () => {
    const priced = priceCartWithBundles(lines(3));
    expect(priced.nextTier).toMatchObject({ minQuantity: 8, photosNeeded: 5 });
  });

  it('is null when no rung remains', () => {
    expect(priceCartWithBundles(lines(9)).nextTier).toBeNull();
  });

  it('is null for an event with no ladder', () => {
    expect(priceCartWithBundles(lines(2, { bundleTiers: null })).nextTier).toBeNull();
  });

  it('picks the group closest to its next rung', () => {
    const cart = [
      // Event 1: 1 photo → needs 2 more.
      line({ photoId: 'a' }),
      // Event 2: 2 photos → needs 1 more. Closer, so this one is prompted.
      line({ photoId: 'b', eventId: 'event-2', eventName: 'Marathon' }),
      line({ photoId: 'c', eventId: 'event-2', eventName: 'Marathon' }),
    ];
    expect(priceCartWithBundles(cart).nextTier).toMatchObject({
      eventId: 'event-2',
      photosNeeded: 1,
    });
  });
});
