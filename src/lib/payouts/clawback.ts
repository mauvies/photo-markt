/**
 * Clawback arithmetic (T-215, absorbing T-237) — how much of a photographer's
 * money comes back when a purchase is reversed by a refund or a lost dispute.
 *
 * Pure and dependency-free, like `batching.ts`: no Stripe, no database.
 *
 * ## Everything here computes a TARGET, never a delta to apply
 *
 * The first version of this module applied a proportion to whatever the row
 * currently held. That is wrong in a webhook: **Stripe redelivers events for up
 * to three days**, and this handler makes redelivery routine, because the access
 * half deliberately fails the request when the database is briefly unavailable.
 * Applying the same "reduce by a quarter" twice reduced twice — a hold walked
 * 2000 → 1500 → 1125 → 844 with a single €5 refund behind it, irrecoverably,
 * since the exactly-once index blocks writing a replacement row.
 *
 * So every function below answers "what SHOULD this row's reversed total be,
 * given what Stripe says has happened to the charge?" The caller then moves the
 * row to that target. Applying the same event five times moves nothing after the
 * first, and refund-then-dispute converges on the same number as
 * dispute-then-refund, because neither reads the row's current value as an input
 * to the proportion.
 *
 * ## An unknown charge total is not a number
 *
 * {@link resolveClawbackTarget} returns `null` when the charge cannot be
 * resolved, and there is no code path that turns that into 0. The previous
 * version passed `chargeTotal ?? 0` and documented it as failing closed; it did
 * the opposite, because `0` is a perfectly usable number that reads as "nothing
 * was refunded" — so the hold stayed fully payable and the retry cron paid a
 * photographer for a charge the bank had already pulled back, while the alert
 * email said the transfer had been reversed. `null` has nowhere to fall through
 * to, which is the only version of "fail closed" that is a property rather than
 * a claim.
 *
 * ## The proportion is taken against the WHOLE charge, fee included
 *
 * `charge.amount` includes the buyer service fee (T-196). **Stripe refunds are
 * amounts, not line items** — a refund carries no information about which part of
 * the cart it corresponds to — so any split is a guess. Proportional-on-total is
 * the guess that is predictable, explainable to a photographer, and monotonic.
 *
 * Rounding is floored throughout, so the platform absorbs the sub-cent remainder
 * — the same direction as `getPhotographerNetCents`.
 */

/**
 * Every status the installed Stripe SDK (22.3.2) declares for a dispute.
 * Enumerated rather than widened to `string` so a new SDK value shows up as a
 * typecheck failure at each `switch` instead of silently taking a default branch.
 */
export type DisputeStatus =
  | 'needs_response'
  | 'under_review'
  | 'won'
  | 'lost'
  | 'prevented'
  | 'warning_needs_response'
  | 'warning_under_review'
  | 'warning_closed';

/** The `warning_*` family: an inquiry, not a chargeback. */
const INQUIRY_STATUSES = new Set<string>([
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
]);

/**
 * Is real money at stake, or is the bank merely asking?
 *
 * ⚠️ Inquiries arrive through the SAME `charge.dispute.created` event as real
 * chargebacks — they are ordinary `Dispute` objects whose status happens to be in
 * the `warning_*` family (the SDK also exposes `payment_method_details.card
 * .case_type = 'inquiry'`, but only for card disputes, so status is the reliable
 * signal). Treating the two alike revoked a paying buyer's photos over a
 * suspicion that frequently closes by itself — and `warning_closed` restored
 * nothing.
 */
export function isChargeback(status: string): boolean {
  return !INQUIRY_STATUSES.has(status);
}

/** Closing states, per the SDK: `charge.dispute.closed` fires for `lost`, `won`
 *  and `warning_closed`; `prevented` completes the union. */
export function isDisputeClosed(status: string): boolean {
  return (
    status === 'lost' || status === 'won' || status === 'warning_closed' || status === 'prevented'
  );
}

/** Open states — the bank is still deciding. */
export function isDisputeOpen(status: string): boolean {
  return !isDisputeClosed(status);
}

export interface ClawbackTarget {
  /** How much of the CHARGE has been taken back: refunds plus a lost dispute. */
  reversedCents: number;
  /** The charge total, buyer service fee included. */
  chargeTotalCents: number;
}

/**
 * What Stripe says has been taken back from this charge — or `null` if we cannot
 * tell, in which case the caller must touch nothing at all.
 *
 * A lost dispute and refunds are additive but capped at the charge: settling a
 * dispute by refunding first (the normal path) would otherwise count the same
 * money twice.
 */
export function resolveClawbackTarget(input: {
  chargeAmountCents: number | null | undefined;
  chargeAmountRefundedCents: number | null | undefined;
  /** The disputed amount, but ONLY when that dispute was lost. */
  disputeLostAmountCents?: number | null;
}): ClawbackTarget | null {
  const total = input.chargeAmountCents;
  if (!isUsableAmount(total) || total <= 0) return null;

  const refunded = isUsableAmount(input.chargeAmountRefundedCents)
    ? Math.max(0, input.chargeAmountRefundedCents)
    : 0;
  const disputed = isUsableAmount(input.disputeLostAmountCents)
    ? Math.max(0, input.disputeLostAmountCents)
    : 0;

  return {
    reversedCents: Math.min(total, refunded + disputed),
    chargeTotalCents: total,
  };
}

/**
 * What this payout row's `reversed_amount_cents` SHOULD be once the target is
 * applied. A full reversal is detected by comparison rather than arithmetic, so
 * it lands exactly on the row's amount with no rounding residue.
 */
export function targetReversedCents(payoutAmountCents: number, target: ClawbackTarget): number {
  if (!isUsableAmount(payoutAmountCents) || payoutAmountCents <= 0) return 0;
  if (target.reversedCents <= 0) return 0;
  if (target.reversedCents >= target.chargeTotalCents) return payoutAmountCents;

  return Math.min(
    payoutAmountCents,
    Math.floor((payoutAmountCents * target.reversedCents) / target.chargeTotalCents),
  );
}

/**
 * How much to reverse right now: the gap between where the row is and where the
 * target says it should be. Never negative — a stale or out-of-order event that
 * reports LESS than is already reversed is an instruction to do nothing, not an
 * error, and certainly not a reason to give money back.
 */
export function reversalDeltaCents(
  payoutAmountCents: number,
  alreadyReversedCents: number,
  target: ClawbackTarget,
): number {
  const already = isUsableAmount(alreadyReversedCents) ? Math.max(0, alreadyReversedCents) : 0;
  return Math.max(0, targetReversedCents(payoutAmountCents, target) - already);
}

/**
 * The Stripe idempotency key for a reversal, derived from the row and its TARGET.
 *
 * ⚠️ Not from `(transfer, charge)`: that pair is constant across successive
 * partial refunds, so a second refund would reuse the first's key and Stripe
 * would hand back the first reversal — the photographer silently keeping money
 * the buyer got back.
 *
 * Keyed on the target rather than on the delta because the target is a pure
 * function of Stripe's state, so a redelivery reproduces it exactly. Stripe
 * compares the WHOLE request body under a key and 400s on divergence, and the
 * body is safe here by construction: for a given key the delta is
 * `target − already`, and once a reversal succeeds `already == target`, so the
 * only call that can ever be made under that key again is the identical retry of
 * one that failed.
 */
export function reversalIdempotencyKey(payoutId: string, targetReversedForRow: number): string {
  return `payout_rev_${payoutId}_${targetReversedForRow}`;
}

/**
 * Is this a number we can do arithmetic with?
 *
 * ⚠️ Not paranoia: these values come off a webhook payload, and `undefined <= 0`
 * is `false` in JavaScript, so an absent amount sails past a naive `<= 0` guard
 * and turns the proportion into `NaN`, which then fails every comparison
 * silently — deciding how much of a photographer's money to take back by
 * accident.
 */
function isUsableAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
