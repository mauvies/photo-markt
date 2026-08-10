import type { StripeConnectStatus } from '@/database/queries/profiles';

/**
 * T-248 — "this event is for sale and its photographer cannot be paid".
 *
 * The product deliberately lets a photographer publish and price an event
 * before connecting their payout account: preparing the event and getting paid
 * for it are separate jobs, and forcing Stripe onboarding up front would block
 * someone who just wants the gallery ready. The cost of that freedom is that
 * the gap must be *loud* — which is what this module decides.
 *
 * ⚠️ The consequence is stronger than "the money waits". Both checkouts refuse
 * a cart whose photographer is not `active` on Connect
 * (`photographer_not_connected`, `cart/actions.ts` + `dashboard/talent/cart/actions.ts`),
 * so a priced event without a payout account is not slow to pay — it cannot be
 * bought at all, and the photographer only finds out from a buyer. That is why
 * the priced case gets its own severity instead of reusing the generic
 * "connect your account" nudge.
 */

/** Connect is only good enough to receive money when it is fully `active`. */
export function canReceivePayouts(status: StripeConnectStatus): boolean {
  return status === 'active';
}

/**
 * Is this event actually selling anything? `price_per_photo` is in euros and
 * free events store `null` or `0` — both are exempt, since a free event needs
 * no payout account and warning about one would be noise.
 */
export function isPricedEvent(pricePerPhoto: number | null | undefined): boolean {
  return typeof pricePerPhoto === 'number' && pricePerPhoto > 0;
}

/**
 * `sales_blocked` — priced events exist and nobody can buy from them.
 * `setup_pending` — nothing is priced yet, so this is still just an unfinished
 * setup step, not an active loss.
 */
export type PayoutReadiness = 'sales_blocked' | 'setup_pending';

export function resolvePayoutReadiness(params: {
  connectStatus: StripeConnectStatus;
  pricedEventCount: number;
}): PayoutReadiness | null {
  if (canReceivePayouts(params.connectStatus)) return null;
  return params.pricedEventCount > 0 ? 'sales_blocked' : 'setup_pending';
}

/**
 * Per-event variant, for the notice that stays on the event while it is alive.
 * Same rule, one event: priced + not payable ⇒ its photos are unsellable.
 */
export function eventSalesBlockedByPayouts(params: {
  pricePerPhoto: number | null | undefined;
  connectStatus: StripeConnectStatus;
}): boolean {
  return isPricedEvent(params.pricePerPhoto) && !canReceivePayouts(params.connectStatus);
}
