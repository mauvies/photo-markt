import { stripe } from './config';
import { isStripeResourceMissing } from './resource-missing';

/**
 * What Stripe says about one PaymentIntent, reduced to the only distinction the
 * order-reconciliation sweep can act on (T-255).
 *
 * The sweep asks a single question — *has this order's money actually been
 * collected?* — because an authenticated `orders` row is written `completed`
 * BEFORE the answer is known. `createAuthenticatedOrder` inserts
 * `status: 'completed'` the moment `checkout.session.completed` arrives, and
 * `drivePayoutsForCheckoutSession` then skips the transfers entirely when the
 * session is `unpaid` (a delayed payment method such as SEPA Direct Debit) and
 * waits for `payment_intent.succeeded`. For as long as those funds take to
 * settle — days, not minutes — the order is `completed` with zero `payouts`
 * rows and **nothing is wrong**. Without this probe the sweep would report that
 * every day until the money landed, which is how a money alert gets ignored.
 *
 * - `settled` — `succeeded`. The money is ours; a missing payout row is real debt.
 *
 *   ⚠️ There is deliberately no settlement TIMESTAMP here, and it is not an
 *   oversight: `PaymentIntent` carries no `status_transitions`, and the one
 *   candidate proxy (`latest_charge.created`) is the moment the charge was
 *   confirmed, not the moment the funds cleared — for SEPA those are days apart,
 *   so it would silently answer the wrong question. The consequence is a real,
 *   accepted residual: a delayed payment that settles on day 4 is already outside
 *   the `created_at` grace, so the pass that first sees `succeeded` may report it
 *   minutes before the `payment_intent.succeeded` delivery pays it. That is why
 *   the alert names the ledger as the authority and never asks for a manual
 *   transfer — the incident self-resolves on the next pass.
 * - `not-settled` — any other status (`processing`, `requires_action`,
 *   `requires_payment_method`, `canceled`, …). Nothing has been collected yet, so
 *   there is nothing to owe the photographer.
 * - `missing` — Stripe has no such intent (a wiped test dataset, an id from an
 *   old dump). Retrying can never succeed, but it is still not an answer about
 *   the money.
 * - `unknown` — the read failed. **Never** an answer.
 */
export type PaymentSettlement =
  | { outcome: 'settled' }
  | { outcome: 'not-settled'; status: string }
  | { outcome: 'missing' }
  | { outcome: 'unknown' };

/**
 * Classify a PaymentIntent by id.
 *
 * ⚠️ **Never throws, and never turns a failure into a verdict.** Same discipline
 * as {@link import('./disputes').retrieveDisputeOutcome} (T-265): the caller uses
 * this to decide whether to raise a money incident, so "we could not read it"
 * has to stay distinguishable from "it has not settled". Collapsing the two in
 * either direction is a bug — one direction cries wolf about money that was
 * never collected, the other buries a genuinely unpaid photographer behind a
 * transient Stripe error.
 *
 * A lookup by id rather than a listing, so a successful response is conclusive:
 * there is no `has_more` ambiguity of the kind that forces `findTransferByGroup`
 * to answer `unknown`.
 */
export async function retrievePaymentSettlement(
  paymentIntentId: string,
): Promise<PaymentSettlement> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return intent.status === 'succeeded'
      ? { outcome: 'settled' }
      : { outcome: 'not-settled', status: intent.status };
  } catch (err) {
    if (isStripeResourceMissing(err)) return { outcome: 'missing' };
    console.error(`[payouts] could not read payment intent ${paymentIntentId}:`, err);
    return { outcome: 'unknown' };
  }
}
