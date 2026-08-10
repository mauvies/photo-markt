'use client';

import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
import { getBuyerServiceFeeCents } from '@/lib/plans';

/**
 * Cart money summary: subtotal, bundle discount, buyer service fee, total
 * (billing v2 T-196; volume pricing T-204).
 *
 * Shared by all four render sites — guest and authenticated carts, each in its
 * desktop panel and its mobile sticky footer — so the four can't drift apart.
 *
 * Both money rules come from the functions the checkouts charge from: the fee
 * from `getBuyerServiceFeeCents`, the discount from `priceCartWithBundles` (both
 * client-safe precisely so this is possible). Displayed and charged therefore
 * cannot diverge, which is the disclosure requirement: the final total, discount
 * and fee included, is shown here before the buyer ever reaches Stripe.
 *
 * Note the ORDER of operations, which is also the order of the rows: the service
 * fee is computed on the POST-DISCOUNT subtotal, because that is what the buyer
 * is actually being charged for the photos.
 *
 * With no discount and the fee configured at 0, this renders exactly the single
 * subtotal row it replaced — no discount line, no fee line, no total line.
 */

interface CartTotalsProps {
  /** Server-validated cart subtotal in cents, at LIST prices (pre-discount). */
  subtotalCents: number;
  /**
   * What volume pricing takes off that subtotal (T-204). Defaults to 0, which
   * reproduces the pre-bundle summary exactly.
   */
  bundleDiscountCents?: number;
  labels: {
    subtotal: string;
    serviceFee: string;
    total: string;
    /** Rendered instead of "0.00" for a wholly free cart. */
    free: string;
    /** Bundle discount row label, e.g. "Volume discount". */
    bundleDiscount?: string;
  };
  /** Desktop panel uses a larger amount than the mobile sticky footer. */
  variant?: 'desktop' | 'mobile';
}

function formatAmount(cents: number): string {
  return `${PLATFORM_CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;
}

export function CartTotals({
  subtotalCents,
  bundleDiscountCents = 0,
  labels,
  variant = 'desktop',
}: CartTotalsProps) {
  // Clamp defensively: a discount can never exceed the subtotal (the kernel
  // guarantees it, but this component also renders optimistic client state).
  const discountCents = Math.max(0, Math.min(bundleDiscountCents, subtotalCents));
  const chargedSubtotalCents = subtotalCents - discountCents;
  const feeCents = getBuyerServiceFeeCents(chargedSubtotalCents);
  const amountClass = variant === 'desktop' ? 'text-xl font-bold' : 'text-lg font-bold';
  // The mobile summary lives in a fixed bar competing for room with a
  // legally-required consent sentence that can't be shortened, so its rows sit
  // tighter than the desktop panel's. Every row still renders — this is
  // spacing, not disclosure.
  const rowGapClass = variant === 'desktop' ? 'space-y-2' : 'space-y-1';
  const totalRowClass = variant === 'desktop' ? 'pt-2' : 'pt-1.5';

  // A free cart still reads "Free" rather than "€0.00" — pre-existing behaviour
  // of both carts, kept.
  const subtotalLabel = subtotalCents === 0 ? labels.free : formatAmount(subtotalCents);

  if (feeCents <= 0 && discountCents <= 0) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{labels.subtotal}</span>
        <span className={`${amountClass} text-foreground`}>{subtotalLabel}</span>
      </div>
    );
  }

  return (
    <div className={rowGapClass}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{labels.subtotal}</span>
        <span className="text-sm text-foreground">{subtotalLabel}</span>
      </div>
      {discountCents > 0 ? (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{labels.bundleDiscount}</span>
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            −{formatAmount(discountCents)}
          </span>
        </div>
      ) : null}
      {feeCents > 0 ? (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{labels.serviceFee}</span>
          <span className="text-sm text-foreground">{formatAmount(feeCents)}</span>
        </div>
      ) : null}
      <div className={`flex items-center justify-between border-t border-border ${totalRowClass}`}>
        <span className="text-sm font-medium text-muted-foreground">{labels.total}</span>
        <span className={`${amountClass} text-foreground`}>
          {formatAmount(chargedSubtotalCents + feeCents)}
        </span>
      </div>
    </div>
  );
}
