/**
 * schema.org `offers` for an event's photo pricing (T-204).
 *
 * Before bundles, the public event page emitted a single `Offer` at the unit
 * price. With a ladder configured that under-quotes the event in the wrong
 * direction for a buyer and the wrong direction for the photographer: a search
 * result reading "€5.00" for an event where eight photos cost €20 states a price
 * that is only true for someone taking one photo.
 *
 * So each rung becomes its own `Offer`, distinguished by `eligibleQuantity` — the
 * standard way schema.org expresses "this price applies from N units" — and the
 * "all photos" ceiling becomes a final Offer with no upper bound.
 *
 * Returns a bare object (not an array) when there is no ladder, so an unbundled
 * event emits byte-identical structured data to before.
 */

import type { BundleTier } from '@/lib/bundle-pricing';
import { PLATFORM_CURRENCY_CODE } from '@/lib/currency';

interface EventOffersInput {
  /** Unit price in EUROS (the `events.price_per_photo` unit). */
  pricePerPhoto: number;
  bundleTiers: BundleTier[] | null;
  bundleAllPhotosCents: number | null;
  eventUrl: string;
}

type JsonLdOffer = Record<string, unknown>;

export function buildEventOffers({
  pricePerPhoto,
  bundleTiers,
  bundleAllPhotosCents,
  eventUrl,
}: EventOffersInput): JsonLdOffer | JsonLdOffer[] {
  const unitOffer: JsonLdOffer = {
    '@type': 'Offer',
    price: pricePerPhoto,
    priceCurrency: PLATFORM_CURRENCY_CODE,
    availability: 'https://schema.org/InStock',
    url: eventUrl,
  };

  const tiers = bundleTiers ?? [];
  const capCents =
    bundleAllPhotosCents != null && bundleAllPhotosCents > 0 ? bundleAllPhotosCents : null;

  if (tiers.length === 0 && capCents === null) return unitOffer;

  const offers: JsonLdOffer[] = [
    {
      ...unitOffer,
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'C62' },
    },
  ];

  for (const tier of tiers) {
    offers.push({
      '@type': 'Offer',
      price: tier.totalPriceCents / 100,
      priceCurrency: PLATFORM_CURRENCY_CODE,
      availability: 'https://schema.org/InStock',
      url: eventUrl,
      eligibleQuantity: {
        '@type': 'QuantitativeValue',
        minValue: tier.minQuantity,
        unitCode: 'C62',
      },
    });
  }

  if (capCents !== null) {
    offers.push({
      '@type': 'Offer',
      price: capCents / 100,
      priceCurrency: PLATFORM_CURRENCY_CODE,
      availability: 'https://schema.org/InStock',
      url: eventUrl,
      // The ceiling has no threshold — it is simply the most a buyer can pay.
      // `description` is the only honest place to say that in an Offer.
      description: 'All photos from this event',
    });
  }

  return offers;
}
