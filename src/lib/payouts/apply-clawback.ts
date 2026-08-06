import {
  applyReversalToHolds,
  confirmPayoutReversal,
  listReversibleRowsForCharge,
  type Payout,
  type PayoutVoidReason,
  releasePayoutReversal,
  reservePayoutReversal,
  settlePayoutPaid,
} from '@/database/queries/payouts';
import { getPhotographerConnectStatuses } from '@/database/queries/profiles';
import type { SupabaseServerClient } from '@/database/queries/types';
import { sendClawbackAlertEmail } from '@/lib/email/send-clawback-alert';
import { reportMoneyIncident } from '@/lib/observability/report-money-incident';
import { payoutTransferGroup } from '@/lib/payouts/batching';
import { computeReversalCents, reversalIdempotencyKey } from '@/lib/payouts/clawback';
import { createTransferReversal, findTransferByGroup } from '@/lib/stripe/connect';

/**
 * Unwind a photographer's money for a charge that came back — one path shared by
 * refunds and lost disputes (T-215, absorbing T-237).
 *
 * **Why one function for both:** T-216's own post-mortem was that its two writers
 * drifted apart on `transfer_group` and wedged every retry for 24 hours. Refunds
 * and disputes reverse the same money for the same reasons; giving each its own
 * copy of the arithmetic and the idempotency rules is how that bug happens twice.
 *
 * Two kinds of money, handled in this order:
 *
 *   1. **Not sent yet** (`pending` holds) — reduced proportionally, or voided on a
 *      full reversal. Done first because it is pure database work that cannot
 *      fail halfway through a Stripe call.
 *   2. **Already sent** (`paid`) — reversed at Stripe for the proportional delta,
 *      then recorded on the row.
 *
 * And one kind that is neither: a `processing` row, whose transfer may or may not
 * exist. It is probed, never guessed — see below.
 *
 * ⚠️ **This function never throws.** It is called from the Stripe webhook, where a
 * thrown error becomes a 500 and Stripe redelivers the event for up to three days
 * — re-running a money operation. Every failure is therefore caught, reported, and
 * summarised in the return value instead.
 */

export interface ClawbackInput {
  supabase: SupabaseServerClient;
  stripeChargeId: string;
  /** CUMULATIVE amount reversed on the charge (`charge.amount_refunded`, or the
   *  dispute's amount) — never the delta of the latest event. */
  reversedCents: number;
  /** The charge total, buyer service fee included. */
  chargeCents: number;
  reason: PayoutVoidReason;
  /** For the alert trail only. */
  orderId?: string | null;
}

export interface ClawbackOutcome {
  holdsVoided: number;
  holdsReduced: number;
  /** Rows whose transfer was reversed at Stripe in this run. */
  reversed: number;
  /** Total cents pulled back in this run. */
  reversedCents: number;
  /** Rows a human has to look at — nothing was changed for these. */
  needsReconciliation: number;
}

/** Dependency seam so the integration tests can drive Stripe deterministically. */
export interface ClawbackDeps {
  createTransferReversal: typeof createTransferReversal;
  findTransferByGroup: typeof findTransferByGroup;
}

const defaultDeps: ClawbackDeps = { createTransferReversal, findTransferByGroup };

/** Report + email, both best-effort. Never rejects. */
async function alert(
  kind: Parameters<typeof reportMoneyIncident>[0]['kind'],
  message: string,
  context: Record<string, string | number | null | undefined>,
  cause?: unknown,
): Promise<void> {
  await reportMoneyIncident({ kind, message, context, cause });
  try {
    await sendClawbackAlertEmail({ kind, summary: message, details: context });
  } catch (err) {
    console.error('[money] failed to send clawback alert email', err);
  }
}

/**
 * Resolve a `processing` row to a transfer that provably exists, or to nothing.
 *
 * A refund can land while a transfer is in flight. The row is then neither a hold
 * to reduce nor a paid transfer to reverse, and the pre-T-215 code simply skipped
 * it — which is one of the holes this ticket closes. Rather than guess, this
 * reuses the retry worker's own recovery probe and keeps its rule: **`unknown`
 * means do nothing.** Reversing a transfer that does not exist and reversing one
 * twice are both worse than a row an operator has to look at.
 */
async function resolveInFlightTransfer(
  supabase: SupabaseServerClient,
  row: Payout,
  deps: ClawbackDeps,
): Promise<string | null> {
  const [connect] = await getPhotographerConnectStatuses(supabase, [row.photographer_id]);
  const destination = connect?.stripe_connect_account_id ?? null;
  if (!destination) return null;

  const probe = await deps.findTransferByGroup({
    transferGroup: payoutTransferGroup(row.id),
    destination,
    amountCents: row.amount_cents,
  });
  if (probe.outcome !== 'found') return null;

  // The transfer really was made — settle the row before reversing it, so the
  // ledger never records a reversal of money it thinks was never sent.
  await settlePayoutPaid(supabase, row.id, probe.transfer.id);
  return probe.transfer.id;
}

export async function applyClawback(
  input: ClawbackInput,
  deps: ClawbackDeps = defaultDeps,
): Promise<ClawbackOutcome> {
  const { supabase, stripeChargeId, reversedCents, chargeCents, reason, orderId } = input;
  const outcome: ClawbackOutcome = {
    holdsVoided: 0,
    holdsReduced: 0,
    reversed: 0,
    reversedCents: 0,
    needsReconciliation: 0,
  };

  // ── 1. Money not sent yet ────────────────────────────────────────────────
  try {
    const holds = await applyReversalToHolds(supabase, {
      stripeChargeId,
      reversedCents,
      chargeCents,
      voidReason: reason,
    });
    outcome.holdsVoided = holds.voided;
    outcome.holdsReduced = holds.reduced;
    if (holds.frozenForReview > 0) {
      outcome.needsReconciliation += holds.frozenForReview;
      await alert(
        'needs-reconciliation',
        'A hold whose Stripe idempotency key was already spent could not be reduced, so it was voided. Decide whether the photographer is still owed the unreversed part.',
        { chargeId: stripeChargeId, orderId, reversedCents, chargeCents },
      );
    }
  } catch (err) {
    outcome.needsReconciliation += 1;
    await alert(
      'needs-reconciliation',
      'Could not apply the reversal to outstanding payout holds; the retry worker may still pay them.',
      { chargeId: stripeChargeId, orderId, reversedCents, chargeCents },
      err,
    );
  }

  // ── 2. Money already sent ────────────────────────────────────────────────
  let rows: Payout[];
  try {
    rows = await listReversibleRowsForCharge(supabase, stripeChargeId);
  } catch (err) {
    await alert(
      'needs-reconciliation',
      'Could not load the payouts for a reversed charge; nothing was clawed back.',
      { chargeId: stripeChargeId, orderId },
      err,
    );
    return outcome;
  }

  for (const row of rows) {
    try {
      let transferId = row.stripe_transfer_id;

      if (row.status === 'processing') {
        transferId = await resolveInFlightTransfer(supabase, row, deps);
        if (!transferId) {
          outcome.needsReconciliation += 1;
          await alert(
            'needs-reconciliation',
            'A payout was mid-transfer when its charge was reversed and Stripe could not confirm the transfer. Left untouched.',
            { chargeId: stripeChargeId, payoutId: row.id, photographerId: row.photographer_id },
          );
          continue;
        }
      }

      if (!transferId) {
        // A `paid` row with no transfer id is not something to reverse — and it
        // should not exist, so say so rather than pass over it.
        outcome.needsReconciliation += 1;
        await alert(
          'needs-reconciliation',
          'A paid payout has no Stripe transfer id, so it cannot be reversed.',
          { chargeId: stripeChargeId, payoutId: row.id },
        );
        continue;
      }

      const delta = computeReversalCents({
        payoutAmountCents: row.amount_cents,
        alreadyReversedCents: row.reversed_amount_cents ?? 0,
        reversedCents,
        chargeCents,
      });
      // Already fully clawed back by an earlier partial refund, or the event is a
      // redelivery of one already applied. Nothing owed, nothing to do.
      if (delta <= 0) continue;

      // Reserve BEFORE calling Stripe, exactly as `openPayoutRow` does for the
      // outbound transfer. Reversing first and recording after would let a failed
      // write leave `reversed_amount_cents` behind the money really pulled back —
      // and since the idempotency key encodes the CUMULATIVE refunded amount, the
      // next partial refund would arrive under a different key, so Stripe would
      // not dedupe it and the same delta would be reversed twice.
      await reservePayoutReversal(supabase, row.id, delta);

      let reversal: Awaited<ReturnType<typeof createTransferReversal>>;
      try {
        reversal = await deps.createTransferReversal({
          transferId,
          amountCents: delta,
          idempotencyKey: reversalIdempotencyKey(row.id, reversedCents),
        });
      } catch (stripeErr) {
        // Give the reservation back so the row reflects reality. Best-effort: if
        // this fails too the row over-reports the reversal, which only makes the
        // next claw back LESS — never more.
        await releasePayoutReversal(supabase, row.id, delta, row.status).catch((releaseErr) =>
          console.error(`[payouts] failed to release reversal hold on ${row.id}:`, releaseErr),
        );
        throw stripeErr;
      }

      await confirmPayoutReversal(supabase, row.id, reversal.id ?? null);

      outcome.reversed += 1;
      outcome.reversedCents += delta;
    } catch (err) {
      // The commonest real cause is `balance_insufficient` on the connected
      // account. It is not fatal and it is not silent: the row keeps its state,
      // so a later reconciliation can retry with full information.
      outcome.needsReconciliation += 1;
      await alert(
        'reversal-failed',
        'Failed to reverse a photographer transfer for a reversed charge.',
        {
          chargeId: stripeChargeId,
          payoutId: row.id,
          photographerId: row.photographer_id,
          transferId: row.stripe_transfer_id,
          amountCents: row.amount_cents,
        },
        err,
      );
    }
  }

  return outcome;
}
