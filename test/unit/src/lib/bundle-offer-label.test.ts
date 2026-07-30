import { describe, expect, it } from 'vitest';
import { resolveBundleOfferLabel } from '@/lib/bundle-offer-label';
import { type BundleTier, getBestBundleOffer } from '@/lib/bundle-pricing';

/**
 * T-204 — the one-line offer shown on the surfaces that have no room for a table
 * (event cards' meta line, the purchase modal, the selection toolbar).
 *
 * The rule under test is which offer gets picked: the DEEPEST one. Showing the
 * shallowest rung would understate the event exactly where a buyer is deciding.
 */

const LADDER: BundleTier[] = [
  { minQuantity: 3, totalPriceCents: 1200 },
  { minQuantity: 8, totalPriceCents: 2000 },
];

const LABELS = { allPhotos: 'all photos {price}', tier: '{n}+ photos {price}' };

describe('getBestBundleOffer', () => {
  it('picks the highest rung, not the first', () => {
    expect(getBestBundleOffer(LADDER, null)).toEqual({
      kind: 'tier',
      minQuantity: 8,
      totalCents: 2000,
    });
  });

  it('ignores array order', () => {
    expect(getBestBundleOffer([...LADDER].reverse(), null)).toMatchObject({ minQuantity: 8 });
  });

  it('prefers the "all photos" ceiling over any rung', () => {
    // Validation keeps the ceiling strictly above every rung total, so it is
    // always the deepest offer on the event.
    expect(getBestBundleOffer(LADDER, 2500)).toEqual({ kind: 'all-photos', totalCents: 2500 });
  });

  it('is null for an event with no ladder', () => {
    expect(getBestBundleOffer(null, null)).toBeNull();
    expect(getBestBundleOffer([], null)).toBeNull();
    expect(getBestBundleOffer(null, 0)).toBeNull();
  });
});

describe('resolveBundleOfferLabel', () => {
  it('formats a rung with its threshold and total', () => {
    expect(resolveBundleOfferLabel(LADDER, null, LABELS)).toBe('8+ photos €20.00');
  });

  it('formats the ceiling without a threshold', () => {
    expect(resolveBundleOfferLabel(null, 2000, LABELS)).toBe('all photos €20.00');
  });

  it('returns null with no ladder, so an unbundled event renders unchanged', () => {
    expect(resolveBundleOfferLabel(null, null, LABELS)).toBeNull();
  });
});
