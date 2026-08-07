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
import {
  type ClawbackTarget,
  reversalDeltaCents,
  reversalIdempotencyKey,
  targetReversedCents,
} from '@/lib/payouts/clawback';
import { createTransferReversal, findTransferByGroup } from '@/lib/stripe/connect';

/**
 * Reconcile a photographer's money to what Stripe says happened to a charge —
 * one path shared by refunds and lost disputes (T-215, absorbing T-237).
 *
 * **Why one function for both:** T-216's own post-mortem was that its two writers
 * drifted apart on `transfer_group` and wedged every retry for 24 hours. Refunds
 * and disputes reverse the same money for the same reasons.
 *
 * **Why reconcile and not apply:** the caller hands in a TARGET derived from
 * Stripe's state, and every row is moved to it. Stripe redelivers events for up to
 * three days — routinely here, since the access half deliberately fails the
 * request on a transient database error — so anything that applied a delta ran
 * repeatedly. It also makes refund-then-dispute and dispute-then-refund converge,
 * which matters because settling a chargeback BY refunding is the normal path.
 *
 * Two kinds of money, in this order:
 *   1. **Not sent yet** (`pending` holds) — moved to target in the database only.
 *   2. **Already sent** (`paid`) — reversed at Stripe for the outstanding delta.
 *
 * And one that is neither: a `processing` row, whose transfer may or may not
 * exist. It is probed, never guessed.
 *
 * ⚠️ **This never throws.** It runs inside the Stripe webhook, where a thrown
 * error becomes a 500 and Stripe redelivers — re-running a money operation. Every
 * failure is caught, reported, and summarised in the return value.
 */

export interface ClawbackInput {
  supabase: SupabaseServerClient;
  stripeChargeId: string;
  /** Where every row should end up. Resolved from Stripe by the caller; when the
   *  caller could not resolve it, it must not call this function at all. */
  target: ClawbackTarget;
  reason: PayoutVoidReason;
  /** For the alert trail only. */
  orderId?: string | null;
}

export interface ClawbackOutcome {
  holdsVoided: number;
  holdsApplied: number;
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
 * A refund can land while a transfer is in flight, leaving the row neither a hold
 * to reduce nor a paid transfer to reverse. Rather than guess, this reuses the
 * retry worker's recovery probe and keeps its rule: **`unknown` means do
 * nothing.** Reversing a transfer that does not exist and reversing one twice are
 * both worse than a row an operator has to look at.
 *
 * Returns the settled row, so the caller never writes back a status captured
 * before the settlement.
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
    // The ORIGINAL amount: that is what the transfer was made for, and
    // `findTransferByGroup` matches on it exactly.
    amountCents: row.amount_cents,
  });
  if (probe.outcome !== 'found') return null;

  await settlePayoutPaid(supabase, row.id, probe.transfer.id);
  return probe.transfer.id;
}

export async function applyClawback(
  input: ClawbackInput,
  deps: ClawbackDeps = defaultDeps,
): Promise<ClawbackOutcome> {
  const { supabase, stripeChargeId, target, reason, orderId } = input;
  const outcome: ClawbackOutcome = {
    holdsVoided: 0,
    holdsApplied: 0,
    reversed: 0,
    reversedCents: 0,
    needsReconciliation: 0,
  };

  // ── 1. Money not sent yet ────────────────────────────────────────────────
  try {
    const holds = await applyReversalToHolds(supabase, {
      stripeChargeId,
      target,
      voidReason: reason,
    });
    outcome.holdsVoided = holds.voided;
    outcome.holdsApplied = holds.applied;
    if (holds.needsReview > 0) {
      outcome.needsReconciliation += holds.needsReview;
      await alert(
        'needs-reconciliation',
        'Outstanding holds for a reversed charge could not be moved to their target — either the retry worker claimed them mid-flight, or their Stripe idempotency key is already spent and they cannot be partially reduced.',
        {
          chargeId: stripeChargeId,
          orderId,
          rows: holds.needsReview,
          reversedCents: target.reversedCents,
          chargeCents: target.chargeTotalCents,
        },
      );
    }
  } catch (err) {
    outcome.needsReconciliation += 1;
    await alert(
      'needs-reconciliation',
      'Could not apply the reversal to outstanding payout holds; the retry worker may still pay them.',
      {
        chargeId: stripeChargeId,
        orderId,
        reversedCents: target.reversedCents,
        chargeCents: target.chargeTotalCents,
      },
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
        outcome.needsReconciliation += 1;
        await alert(
          'needs-reconciliation',
          'A paid payout has no Stripe transfer id, so it cannot be reversed.',
          { chargeId: stripeChargeId, payoutId: row.id },
        );
        continue;
      }

      const alreadyReversed = row.reversed_amount_cents ?? 0;
      const delta = reversalDeltaCents(row.amount_cents, alreadyReversed, target);
      // Already at target — a redelivery, or an earlier partial refund that
      // already covered this. Nothing owed, nothing to do.
      if (delta <= 0) continue;

      // Reserve BEFORE calling Stripe, as `openPayoutRow` does for the outbound
      // transfer. A crash in between then makes the row over-report the reversal,
      // so the next reconcile claws back LESS — never more.
      await reservePayoutReversal(supabase, row.id, delta);

      let reversal: Awaited<ReturnType<typeof createTransferReversal>>;
      try {
        reversal = await deps.createTransferReversal({
          transferId,
          amountCents: delta,
          idempotencyKey: reversalIdempotencyKey(
            row.id,
            targetReversedCents(row.amount_cents, target),
          ),
        });
      } catch (stripeErr) {
        await releasePayoutReversal(supabase, row.id, delta).catch((releaseErr) =>
          console.error(`[payouts] failed to release reversal hold on ${row.id}:`, releaseErr),
        );
        throw stripeErr;
      }

      await confirmPayoutReversal(supabase, row.id, reversal.id ?? null);

      outcome.reversed += 1;
      outcome.reversedCents += delta;
    } catch (err) {
      // The commonest real cause is `balance_insufficient` on the connected
      // account. Not fatal and not silent: the row keeps its state so a later
      // reconcile retries with full information.
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
