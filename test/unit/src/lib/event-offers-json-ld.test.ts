import { describe, expect, it } from 'vitest';
import type { BundleTier } from '@/lib/bundle-pricing';
import { buildEventOffers } from '@/lib/event-offers-json-ld';

/**
 * T-204 — the public event page's schema.org `offers`.
 *
 * The property that matters: an unbundled event emits exactly the single Offer it
 * emitted before bundles existed (so nothing about existing structured data
 * changes), and a bundled one describes every rung — a search result quoting
 * "€5.00" for an event where eight photos cost €20 states a price that is only
 * true for a buyer taking one photo.
 */

const LADDER: BundleTier[] = [
  { minQuantity: 3, totalPriceCents: 1200 },
  { minQuantity: 8, totalPriceCents: 2000 },
];

const EVENT_URL = 'https://photomarkt.test/en/events/abc';

describe('buildEventOffers', () => {
  it('emits a single unit-price Offer when there is no ladder', () => {
    const offers = buildEventOffers({
      pricePerPhoto: 5,
      bundleTiers: null,
      bundleAllPhotosCents: null,
      eventUrl: EVENT_URL,
    });

    expect(Array.isArray(offers)).toBe(false);
    expect(offers).toEqual({
      '@type': 'Offer',
      price: 5,
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: EVENT_URL,
    });
  });

  it('emits one Offer per rung, with the threshold as eligibleQuantity', () => {
    const offers = buildEventOffers({
      pricePerPhoto: 5,
      bundleTiers: LADDER,
      bundleAllPhotosCents: null,
      eventUrl: EVENT_URL,
    }) as Record<string, unknown>[];

    expect(offers).toHaveLength(3);
    expect(offers[0]).toMatchObject({ price: 5 });
    expect(offers[1]).toMatchObject({
      price: 12,
      eligibleQuantity: { '@type': 'QuantitativeValue', minValue: 3, unitCode: 'C62' },
    });
    expect(offers[2]).toMatchObject({ price: 20, eligibleQuantity: { minValue: 8 } });
  });

  it('emits the "all photos" ceiling as a final Offer with no threshold', () => {
    const offers = buildEventOffers({
      pricePerPhoto: 5,
      bundleTiers: null,
      bundleAllPhotosCents: 2000,
      eventUrl: EVENT_URL,
    }) as Record<string, unknown>[];

    expect(offers).toHaveLength(2);
    // A ceiling has no threshold to express — it is simply the most anyone pays.
    expect(offers[1]).toMatchObject({ price: 20 });
    expect(offers[1].eligibleQuantity).toBeUndefined();
  });

  it('states prices in euros, not cents', () => {
    const offers = buildEventOffers({
      pricePerPhoto: 5,
      bundleTiers: [{ minQuantity: 4, totalPriceCents: 1550 }],
      bundleAllPhotosCents: null,
      eventUrl: EVENT_URL,
    }) as Record<string, unknown>[];

    expect(offers[1].price).toBe(15.5);
  });
});
