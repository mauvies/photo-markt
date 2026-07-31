'use client';

import { BUNDLE_PRICING_ENABLED } from '@/lib/bundle-pricing';

/**
 * Explains, on the photographer's Sales and Earnings views, what a bundle
 * discount is and what it is not (T-205).
 *
 * A bundled sale reports the **charged** amount as gross — the buyer paid the
 * package price, not `quantity × price_per_photo` — so the figures are lower
 * than the list total by the discount the photographer themselves set. Without
 * saying so, that gap invites two wrong readings: that the platform deducted
 * something extra, or that the buyer's service fee came out of their money.
 * Neither is true; the commission column already shows the platform's entire
 * cut, and the fee is the buyer's (see `BuyerFeeNote`, which sits alongside).
 *
 * Renders nothing unless the photographer has actually configured volume
 * pricing somewhere — same rule as `BuyerFeeNote`, which stays silent while no
 * fee is charged. Explaining a discount nobody offers is noise.
 */

interface BundleDiscountNoteProps {
  /** Localized copy, e.g. dict.earnings.bundleDiscountNote. */
  children: string;
  /** Whether this photographer has any event with a ladder or an all-photos cap. */
  hasBundlePricing: boolean;
  className?: string;
}

export function BundleDiscountNote({
  children,
  hasBundlePricing,
  className,
}: BundleDiscountNoteProps) {
  if (!BUNDLE_PRICING_ENABLED || !hasBundlePricing) return null;

  return <p className={`text-xs text-muted-foreground ${className ?? ''}`.trim()}>{children}</p>;
}
