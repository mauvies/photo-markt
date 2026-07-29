'use client';

import { isBuyerServiceFeeEnabled } from '@/lib/plans';

/**
 * Explains, on the photographer's sales and earnings views, that the buyer
 * service fee is not their money (billing v2, T-197).
 *
 * The fee is charged to the BUYER on top of the photo price and is platform
 * revenue: it is neither added to nor subtracted from the photographer's
 * figures. Without saying so, the numbers invite the wrong reading — especially
 * on Pro, where the commission is 0% and the photographer's net equals the full
 * price, so a fee appearing on the buyer's receipt could easily look like
 * something taken out of their earnings.
 *
 * Renders nothing while no fee is charged: explaining a fee nobody pays would
 * be worse than saying nothing.
 */

interface BuyerFeeNoteProps {
  /** Localized copy, e.g. dict.earnings.buyerFeeNote. */
  children: string;
  className?: string;
}

export function BuyerFeeNote({ children, className }: BuyerFeeNoteProps) {
  if (!isBuyerServiceFeeEnabled()) return null;

  return <p className={`text-xs text-muted-foreground ${className ?? ''}`.trim()}>{children}</p>;
}
