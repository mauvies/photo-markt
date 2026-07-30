/**
 * One-line rendering of an event's best bundle offer (T-204).
 *
 * Three surfaces show the offer in a single line — the meta line that feeds
 * event cards and both event headers, the purchase modal right above
 * add-to-cart, and the selection toolbar — and a card that says "€5/photo" on an
 * event where six photos cost €12 is quoting a wrong price. They share this
 * formatter so they can't word or round the same offer differently.
 *
 * Client-safe and pure: the label is built from the same `getBestBundleOffer`
 * the kernel exposes, and takes its copy from the caller's dictionary rather
 * than hardcoding any string.
 */

import { type BundleOffer, type BundleTier, getBestBundleOffer } from '@/lib/bundle-pricing';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';

export interface BundleOfferLabels {
  /** "All photos {price}" — the flat "Foto-Flat" ceiling. */
  allPhotos: string;
  /** "{n}+ photos {price}" — a rung. */
  tier: string;
}

export function formatBundleOfferCents(cents: number): string {
  return `${PLATFORM_CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;
}

/** Format an already-resolved offer. */
export function formatBundleOffer(offer: BundleOffer, labels: BundleOfferLabels): string {
  const price = formatBundleOfferCents(offer.totalCents);
  if (offer.kind === 'all-photos') return labels.allPhotos.replace('{price}', price);
  return labels.tier.replace('{n}', String(offer.minQuantity)).replace('{price}', price);
}

/**
 * Resolve and format an event's best offer in one call, or null when the event
 * has no ladder — the signature the display components actually want.
 */
export function resolveBundleOfferLabel(
  tiers: readonly BundleTier[] | null | undefined,
  allPhotosCents: number | null | undefined,
  labels: BundleOfferLabels,
): string | null {
  const offer = getBestBundleOffer(tiers, allPhotosCents);
  return offer ? formatBundleOffer(offer, labels) : null;
}
