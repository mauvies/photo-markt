'use client';

import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
import { getBuyerServiceFeeCents } from '@/lib/plans';

/**
 * Cart money summary: subtotal, buyer service fee, total (billing v2, T-196).
 *
 * Shared by all four render sites — guest and authenticated carts, each in its
 * desktop panel and its mobile sticky footer — so the four can't drift apart.
 *
 * The fee comes from `getBuyerServiceFeeCents`, the same function the checkout
 * charges from (`plans.ts` is not server-only precisely so this is possible).
 * Displayed and charged therefore cannot diverge, which is the disclosure
 * requirement: the total including the fee is shown here, before the buyer ever
 * reaches Stripe.
 *
 * While the fee is configured at 0 this renders exactly the single subtotal row
 * it replaced — no fee line, no total line, no visual change at all.
 */

interface CartTotalsProps {
  /** Server-validated cart subtotal in cents. */
  subtotalCents: number;
  labels: {
    subtotal: string;
    serviceFee: string;
    total: string;
    /** Rendered instead of "0.00" for a wholly free cart. */
    free: string;
  };
  /** Desktop panel uses a larger amount than the mobile sticky footer. */
  variant?: 'desktop' | 'mobile';
}

function formatAmount(cents: number): string {
  return `${PLATFORM_CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;
}

export function CartTotals({ subtotalCents, labels, variant = 'desktop' }: CartTotalsProps) {
  const feeCents = getBuyerServiceFeeCents(subtotalCents);
  const amountClass = variant === 'desktop' ? 'text-xl font-bold' : 'text-lg font-bold';

  // A free cart still reads "Free" rather than "€0.00" — pre-existing behaviour
  // of both carts, kept.
  const subtotalLabel = subtotalCents === 0 ? labels.free : formatAmount(subtotalCents);

  if (feeCents <= 0) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{labels.subtotal}</span>
        <span className={`${amountClass} text-foreground`}>{subtotalLabel}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{labels.subtotal}</span>
        <span className="text-sm text-foreground">{subtotalLabel}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{labels.serviceFee}</span>
        <span className="text-sm text-foreground">{formatAmount(feeCents)}</span>
      </div>
      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-sm font-medium text-muted-foreground">{labels.total}</span>
        <span className={`${amountClass} text-foreground`}>
          {formatAmount(subtotalCents + feeCents)}
        </span>
      </div>
    </div>
  );
}
