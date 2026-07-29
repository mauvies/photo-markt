/**
 * The buyer service fee as a Stripe line item (billing v2, T-194/T-196).
 *
 * Both checkout flows — guest (`app/[lang]/cart/actions.ts`) and authenticated
 * (`app/[lang]/dashboard/talent/cart/actions.ts`) — build the fee here so the
 * two receipts are byte-identical in shape. The amount comes from
 * `getBuyerServiceFeeCents`, the single calc point; it is never recomputed at a
 * call site, so the charge can't drift from what the cart displayed.
 *
 * The fee is its own line item rather than being folded into a photo's price,
 * because the buyer's receipt has to itemize it — under PSD2 a flat, uniform
 * service fee is lawful, and the risk is surprise pricing, not the fee itself.
 */

import type Stripe from 'stripe';
import { PLATFORM_CURRENCY } from '@/lib/currency';
import { getBuyerServiceFeeCents } from '@/lib/plans';

/**
 * Product name on the buyer's Stripe receipt. English, matching the existing
 * photo line items ("Photo from {event}") — checkout sessions are built in
 * Server Actions, which have no dictionary.
 */
export const SERVICE_FEE_LINE_ITEM_NAME = 'Service fee';

/**
 * The fee line item for a validated cart subtotal, or `null` when no fee is
 * due — a zero-amount line item is not something to send Stripe, and the
 * kill-switch (fee amounts at 0) must produce a session byte-identical to v1.
 *
 * `subtotalCents` MUST be the server-validated subtotal (what survives the
 * purchasability and accessibility gates), never a client-supplied figure.
 */
export function buildServiceFeeLineItem(
  subtotalCents: number,
): Stripe.Checkout.SessionCreateParams.LineItem | null {
  const feeCents = getBuyerServiceFeeCents(subtotalCents);
  if (feeCents <= 0) return null;

  return {
    price_data: {
      currency: PLATFORM_CURRENCY,
      product_data: { name: SERVICE_FEE_LINE_ITEM_NAME },
      unit_amount: feeCents,
    },
    quantity: 1,
  };
}
