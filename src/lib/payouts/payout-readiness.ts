import type { StripeConnectStatus } from '@/database/queries/profiles';

/**
 * T-248 — "this photographer is selling and cannot yet be paid."
 *
 * The product deliberately lets a photographer publish, price and SELL an event
 * before connecting their payout account: preparing the event, selling it, and
 * getting paid for it are separate readiness states, and forcing Stripe
 * onboarding up front would block someone who just wants the gallery ready.
 *
 * ⚠️ **Nobody is refused.** Neither checkout looks at Connect status — the
 * webhook records the photographer's net as a `payouts` row with
 * `hold_reason = 'connect_inactive'`, and `retry-pending-payouts` drains it the
 * moment `account.updated` reports the account active. The money waits; the sale
 * does not. (Before this, both checkouts returned `photographer_not_connected`,
 * so a priced event could not be bought at all and its owner's only signal was
 * a buyer asking why nothing worked.)
 *
 * The cost of that freedom is that the gap must be *loud*, and loud in
 * proportion: a priced event is a forecast ("sales will be held"), an
 * outstanding hold is a fact ("€X of yours is waiting"). This module is the one
 * place that decides which, so every surface showing it agrees.
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
 * `money_held` — sales already happened and their net is sitting in the ledger.
 * `sales_will_hold` — priced events exist but nothing has sold yet.
 * `setup_pending` — nothing priced either; still just an unfinished setup step.
 */
export type PayoutReadiness = 'money_held' | 'sales_will_hold' | 'setup_pending';

export function resolvePayoutReadiness(params: {
  connectStatus: StripeConnectStatus;
  pricedEventCount: number;
  /**
   * Outstanding held payouts in cents, from `getTotalPendingPayouts` — the same
   * query behind the Earnings alert, so the two surfaces cannot quote different
   * amounts for the same money.
   */
  heldCents: number;
}): PayoutReadiness | null {
  if (canReceivePayouts(params.connectStatus)) return null;
  if (params.heldCents > 0) return 'money_held';
  return params.pricedEventCount > 0 ? 'sales_will_hold' : 'setup_pending';
}

/**
 * Per-event variant, for the notice that stays on the event while it is alive:
 * this event sells, and its earnings will be held rather than paid out.
 */
export function eventEarningsWillBeHeld(params: {
  pricePerPhoto: number | null | undefined;
  connectStatus: StripeConnectStatus;
}): boolean {
  return isPricedEvent(params.pricePerPhoto) && !canReceivePayouts(params.connectStatus);
}
