'use client';

import { useCallback } from 'react';
import type { BundleOfferLabels } from '@/lib/bundle-offer-label';
import { formatBundleOfferCents } from '@/lib/bundle-offer-label';
import { type BundleTier, getBundlePriceCents, getNextBundleTier } from '@/lib/bundle-pricing';

/**
 * Buyer-facing bundle copy for one event view (T-204).
 *
 * Both event viewers — the public page and the talent-dashboard view — render the
 * identical set of bundle affordances, so they take the identical label bag and
 * share the hook below. Anything that let the two drift would let them quote
 * different prices for the same event, which is exactly what the shared
 * `EventPricingSection` was introduced to prevent in T-203.
 */
export interface EventBundleLabels extends BundleOfferLabels {
  /** Running total for the current selection. `{price}`. */
  selectionTotal: string;
  /** Next-rung nudge in the toolbar. `{n}` more photos, `{price}` resulting total. */
  selectionNextTier: string;
  /** "Add all my photos" button, shown after a face search. */
  addAllMyPhotos: string;
}

/**
 * Price the current selection through the bundle kernel and render it as the
 * toolbar note (T-204).
 *
 * It is a hook rather than a component because `PhotoGallery` owns the selection
 * state and hands the count down through `renderSelectionNote`.
 *
 * Deliberately prices with the SAME `getBundlePriceCents` the checkout charges
 * from: while selecting, a buyer is deciding whether the next photo is worth it,
 * and a note computed any other way would be an estimate at the exact moment
 * accuracy matters.
 */
export function useBundleSelectionNote({
  pricePerPhoto,
  bundleTiers,
  bundleAllPhotosCents,
  labels,
}: {
  /** Unit price in EUROS (the `events.price_per_photo` unit). */
  pricePerPhoto: number | null;
  bundleTiers?: BundleTier[] | null;
  bundleAllPhotosCents?: number | null;
  labels?: EventBundleLabels;
}): ((selectedCount: number) => string | null) | undefined {
  const unitCents =
    pricePerPhoto != null && pricePerPhoto > 0 ? Math.round(pricePerPhoto * 100) : 0;
  const hasSchedule =
    (bundleTiers != null && bundleTiers.length > 0) ||
    (bundleAllPhotosCents != null && bundleAllPhotosCents > 0);

  const render = useCallback(
    (selectedCount: number): string | null => {
      if (!labels || selectedCount <= 0 || unitCents <= 0) return null;

      const total = getBundlePriceCents(
        selectedCount,
        unitCents,
        bundleTiers,
        bundleAllPhotosCents,
      );
      const parts = [labels.selectionTotal.replace('{price}', formatBundleOfferCents(total))];

      const next = getNextBundleTier(selectedCount, bundleTiers);
      if (next) {
        const nextTotal = getBundlePriceCents(
          next.minQuantity,
          unitCents,
          bundleTiers,
          bundleAllPhotosCents,
        );
        parts.push(
          labels.selectionNextTier
            .replace('{n}', String(next.minQuantity - selectedCount))
            .replace('{price}', formatBundleOfferCents(nextTotal)),
        );
      }

      return parts.join(' · ');
    },
    [labels, unitCents, bundleTiers, bundleAllPhotosCents],
  );

  // No ladder ⇒ no note at all, so an unbundled event's toolbar is unchanged.
  return hasSchedule && labels && unitCents > 0 ? render : undefined;
}
