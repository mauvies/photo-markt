/**
 * Clawback arithmetic (T-215, absorbing T-237) — how much of a photographer's
 * money comes back when a purchase is reversed by a refund or a lost dispute.
 *
 * Pure and dependency-free, like `batching.ts`: no Stripe, no database, so every
 * rule below is unit-testable on its own. The orchestration that acts on these
 * numbers lives in `apply-clawback.ts`.
 *
 * ## Everything is integer cents, never a float ratio
 *
 * Each function takes `reversedCents` / `chargeCents` rather than a pre-computed
 * ratio, and multiplies before dividing. A float ratio would make a FULL reversal
 * land at `amount × 0.9999999` and leave a phantom cent with the photographer on
 * a sale that was entirely taken back — the kind of drift that only shows up in
 * a reconciliation months later. Full reversal is also detected by comparison,
 * not by arithmetic, so it is exact by construction.
 *
 * ## The proportion is taken against the WHOLE charge, fee included
 *
 * `charge.amount` includes the buyer service fee (T-196), so refunding exactly
 * the fee still claws back a sliver of the photographer's net. That is a known,
 * accepted approximation: **Stripe refunds are amounts, not line items** — a
 * refund carries no information about which part of the cart it corresponds to,
 * so any split is a guess. Proportional-on-total is the guess that is
 * predictable, explainable to a photographer, and monotonic in the refunded
 * amount. Reconstructing an allocation from `order_items` was rejected: it would
 * invent a fact Stripe never gave us and could disagree with the buyer's
 * statement.
 *
 * ## Rounding favours the photographer
 *
 * Every reversal is floored, so the platform absorbs the sub-cent remainder —
 * the same direction as `getPhotographerNetCents`. Rounding the other way would
 * mean clawing back a cent more than the refund justified.
 */

/**
 * Is this a complete reversal of the charge?
 *
 * `>=` rather than `===` on purpose: `charge.amount_refunded` can reach
 * `charge.amount` through several partial refunds, and a dispute's `amount` is
 * compared against the same charge total.
 */
export function isFullReversal(reversedCents: number, chargeCents: number): boolean {
  if (!isUsableAmount(reversedCents) || !isUsableAmount(chargeCents)) return false;
  if (chargeCents <= 0) return false;
  return reversedCents >= chargeCents;
}

/**
 * Is this a number we can divide by, or multiply, without producing nonsense?
 *
 * ⚠️ Not paranoia: these values come off a Stripe webhook payload, and
 * `undefined <= 0` is `false` in JavaScript, so an absent `charge.amount` sails
 * straight past a naive `<= 0` guard and turns the proportion into `NaN`. `NaN`
 * then fails every comparison silently, so the caller would take whichever branch
 * happened to be the `else` — deciding how much of a photographer's money to take
 * back by accident. Every entry point below therefore checks the inputs and picks
 * its fail-closed direction explicitly.
 */
function isUsableAmount(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

export interface ReversalInput {
  /** The payout row's own amount — the photographer's net for this charge. */
  payoutAmountCents: number;
  /** What has already been clawed back from this row by earlier reversals. */
  alreadyReversedCents: number;
  /** CUMULATIVE amount reversed on the charge (`charge.amount_refunded`, or the
   *  dispute's amount) — not the delta of the latest refund. */
  reversedCents: number;
  /** The charge total, fee included. */
  chargeCents: number;
}

/**
 * How much to reverse **right now**: the target total for this row minus what
 * has already been taken back.
 *
 * Returning the delta rather than the target is what makes successive partial
 * refunds compose. The result is clamped into `[0, payoutAmountCents −
 * alreadyReversedCents]`, so no sequence of events — including a nonsensical one
 * from a redelivery or a manual Stripe action — can claw back more than was
 * transferred, and a stale event that reports LESS than what is already reversed
 * yields 0 rather than a negative "reversal" (which Stripe would reject anyway,
 * but silently doing nothing is the right answer, not an error).
 */
export function computeReversalCents(input: ReversalInput): number {
  const { payoutAmountCents, alreadyReversedCents, reversedCents, chargeCents } = input;
  if (!isUsableAmount(payoutAmountCents) || payoutAmountCents <= 0) return 0;
  // Unknown proportion ⇒ reverse NOTHING. Money already sent is the irreversible
  // direction, so an incomplete payload must never be turned into a guess about
  // how much to take back; the row is left for reconciliation instead.
  if (!isUsableAmount(reversedCents) || !isUsableAmount(chargeCents) || chargeCents <= 0) return 0;

  const remaining = payoutAmountCents - Math.max(0, alreadyReversedCents);
  if (remaining <= 0) return 0;

  const target = isFullReversal(reversedCents, chargeCents)
    ? payoutAmountCents
    : chargeCents > 0 && reversedCents > 0
      ? Math.floor((payoutAmountCents * reversedCents) / chargeCents)
      : 0;

  const delta = target - Math.max(0, alreadyReversedCents);
  return Math.min(Math.max(0, delta), remaining);
}

export interface HoldReductionInput {
  /** The outstanding hold's current amount. */
  amountCents: number;
  /** CUMULATIVE amount reversed on the charge. */
  reversedCents: number;
  /** The charge total, fee included. */
  chargeCents: number;
}

/**
 * What an outstanding (not yet sent) hold should be worth after the reversal —
 * or `null` meaning "void it".
 *
 * This is the T-237 fix. `voidHoldsForCharge` cancelled the whole hold on ANY
 * `charge.refunded`, and Stripe fires that event for partial refunds too, so
 * refunding €5 of a €20 sale destroyed the photographer's net on the remaining
 * €15 — irrecoverably, since the partial unique index on
 * `(stripe_charge_id, photographer_id)` blocks inserting a replacement row.
 *
 * `null` is returned for a full reversal, and also when the survivor would land
 * at or below zero: `payouts.amount_cents` carries a `> 0` CHECK that is
 * deliberately kept, so "nothing left worth paying" has to be expressed as a
 * voided row rather than as a zero amount.
 *
 * Note that the second branch is **defensive, not reachable today**: flooring the
 * deduction means a partial reversal always leaves at least one cent, so only a
 * full reversal voids a hold. It is kept because it is the invariant the DB
 * CHECK enforces anyway, and because rounding is exactly the kind of detail a
 * later change touches without noticing what depends on it. A hold reduced below
 * Stripe's 50-cent floor is not a problem — that is what the `below_minimum`
 * aggregation path in `batching.ts` already exists for.
 */
export function computeReducedHoldCents(input: HoldReductionInput): number | null {
  const { amountCents, reversedCents, chargeCents } = input;
  if (isFullReversal(reversedCents, chargeCents)) return null;
  if (!isUsableAmount(amountCents) || amountCents <= 0) return null;
  // Unknown proportion ⇒ VOID the hold. The opposite fail-closed direction from
  // `computeReversalCents`, and deliberately so: this is money not yet sent, so
  // not sending it is recoverable (the row can be restored by UPDATE) while
  // paying a refunded buyer's money to the photographer is not.
  if (!isUsableAmount(reversedCents) || !isUsableAmount(chargeCents)) return null;
  if (chargeCents <= 0 || reversedCents <= 0) return amountCents;

  const survivor = amountCents - Math.floor((amountCents * reversedCents) / chargeCents);
  return survivor > 0 ? survivor : null;
}

/**
 * The Stripe idempotency key for a reversal.
 *
 * ⚠️ **Keyed on the CUMULATIVE reversed amount, not on `(transfer, charge)`.**
 * The ticket originally proposed the latter, but that pair is constant across
 * successive partial refunds of the same charge — so a second partial refund
 * would reuse the first refund's key and Stripe would return the first reversal
 * instead of creating a new one. The photographer would keep money the buyer had
 * been given back, and nothing would log an error. Keying on the cumulative
 * amount makes a redelivery of the same event reuse its key (idempotent, as
 * intended) while a genuinely larger refund is a distinct operation.
 *
 * Same discipline as T-216's `payoutIdempotencyKey`, and the same trap applies:
 * Stripe compares the WHOLE request body against the one stored under a key and
 * 400s on divergence, so the amount sent under a given key must be derived
 * deterministically from state — which is exactly what `computeReversalCents`
 * does.
 */
export function reversalIdempotencyKey(payoutId: string, cumulativeReversedCents: number): string {
  return `payout_rev_${payoutId}_${cumulativeReversedCents}`;
}
