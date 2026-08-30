import { isDisputeOpen } from '@/lib/payouts/clawback';
import { stripe } from './config';
import { isStripeResourceMissing } from './resource-missing';

/**
 * What Stripe says about one dispute, reduced to the only distinction the freeze
 * sweep can act on (T-265).
 *
 * - `open` — the bank is still deciding. A chargeback legitimately stays here for
 *   60–90 days, so a frozen hold behind it is not stuck.
 * - `closed-not-lost` — `won`, `warning_closed` or `prevented`. The freeze should
 *   have been released and was not.
 * - `lost` — the freeze is the correct terminal state; the buyer took the money
 *   back and the clawback already ran.
 * - `missing` — Stripe has no such dispute (a wiped test dataset, an id from an
 *   old dump). Retrying can never succeed, but neither can we conclude anything
 *   about the money.
 * - `unknown` — the read failed. **Never** an answer.
 */
export type DisputeOutcome =
  | { outcome: 'open'; status: string }
  | { outcome: 'closed-not-lost'; status: string }
  | { outcome: 'lost'; status: string }
  | { outcome: 'missing' }
  | { outcome: 'unknown' };

/**
 * Classify a dispute by id.
 *
 * ⚠️ **Never throws, and never turns a failure into a verdict.** The caller uses
 * this to decide whether to release a payout freeze, so "we could not read it"
 * and "it is still open" must stay distinguishable from "it closed in our
 * favour": releasing on a bad read would hand a photographer money the bank may
 * still pull back, and the next pass cannot undo a transfer.
 *
 * Unlike `findTransferByGroup`, this is a lookup by id rather than a listing, so
 * there is no `has_more` ambiguity — a successful response is conclusive. That
 * difference is what makes repairing a stale freeze safe where repairing an
 * unconfirmed reversal is not (T-264 vs. T-265).
 */
export async function retrieveDisputeOutcome(disputeId: string): Promise<DisputeOutcome> {
  try {
    const dispute = await stripe.disputes.retrieve(disputeId);
    const status = dispute.status;
    if (isDisputeOpen(status)) return { outcome: 'open', status };
    return status === 'lost' ? { outcome: 'lost', status } : { outcome: 'closed-not-lost', status };
  } catch (err) {
    if (isStripeResourceMissing(err)) return { outcome: 'missing' };
    console.error(`[payouts] could not read dispute ${disputeId}:`, err);
    return { outcome: 'unknown' };
  }
}

/**
 * What Stripe says has been refunded on a charge (T-265).
 *
 * The freeze sweep needs this before it releases anything, and the reason is
 * subtle enough to be worth stating: a chargeback freeze leaves the row
 * `cancelled`, and BOTH clawback selectors skip it — `applyReversalToHolds`
 * takes only `pending` rows and `listReversibleRowsForCharge` only
 * `paid`/`processing`/`reversed`. So a refund landing while the row is frozen
 * records nothing on it, `reversed_amount_cents` stays 0, and releasing the row
 * later hands back its FULL original value for a sale the buyer got back. The
 * webhook avoids this by following its own restore with
 * `applyClawback({ reason: 'refund' })`; the sweep instead refuses to release a
 * charge that has any refund, which is the same protection without moving money
 * from a cron.
 *
 * Never throws. `null` means "could not read", which the caller must treat as
 * "do not release" — never as "no refunds".
 */
export async function retrieveChargeRefundState(
  chargeId: string,
): Promise<{ amountRefundedCents: number } | null> {
  try {
    const charge = await stripe.charges.retrieve(chargeId);
    const refunded = charge.amount_refunded;
    if (typeof refunded !== 'number' || !Number.isFinite(refunded)) return null;
    return { amountRefundedCents: refunded };
  } catch (err) {
    console.error(`[payouts] could not read charge ${chargeId}:`, err);
    return null;
  }
}
