import type Stripe from 'stripe';

/**
 * Resolve a Stripe subscription's current period end as an ISO timestamp.
 *
 * `current_period_end` moved off the subscription root onto each item in
 * Stripe's `basil` API version (2025-03-31); our pinned version (dahlia) is
 * well past it, so the root field is gone and the typed location is
 * `items.data[].current_period_end`. We read `data[0]`: our subscriptions are
 * always single-item (one plan → one price → one item), so every item shares
 * one billing period. Epoch seconds in, ISO out; `null` when the field is
 * absent or not a number (T-159).
 *
 * Extracted so the webhook and the cancel/reactivate actions all read the
 * period end the same way — this rule has already been read from the wrong
 * place once, and three hand-written copies is how that happens again (T-214).
 */
export function subscriptionPeriodEndISO(subscription: Stripe.Subscription): string | null {
  const itemPeriodEnd = subscription.items?.data?.[0]?.current_period_end;
  return typeof itemPeriodEnd === 'number' ? new Date(itemPeriodEnd * 1000).toISOString() : null;
}
