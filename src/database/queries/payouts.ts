/**
 * Payouts-related database queries
 * For tracking photographer payout requests and processing
 */

import { type ClawbackTarget, targetReversedCents } from '@/lib/payouts/clawback';
import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

/**
 * `processing` (T-216) is the state between "this row owns the money" and "the
 * transfer is confirmed". A row sits here while a Stripe call is in flight, and
 * the retry worker re-drives it with the SAME idempotency key — which is why a
 * claim is never reverted once a Stripe call has been issued against it.
 */
export type PayoutStatus =
  | 'pending'
  | 'approved'
  | 'processing'
  | 'paid'
  | 'cancelled'
  /**
   * Fully clawed back (T-215) — the buyer was refunded, or their dispute was
   * lost, and every cent transferred for this sale has been pulled back. A
   * PARTIALLY reversed row deliberately stays `paid` with a non-zero
   * `reversed_amount_cents`, because the photographer did keep the rest.
   */
  | 'reversed';

/** Why a payout could not be sent when the sale completed (T-216). */
export type PayoutHoldReason = 'connect_inactive' | 'below_minimum' | 'transfer_failed';

/**
 * What voided an outstanding hold (T-215). Recorded as its own column, not
 * inferred from `admin_notes`, so that a WON dispute can restore exactly the
 * holds it voided and never a hold voided by a refund.
 */
export type PayoutVoidReason = 'refund' | 'dispute';

/** Which table `order_id` points at — `orders` and `guest_orders` are separate. */
export type PayoutOrderKind = 'order' | 'guest_order';

export interface Payout {
  id: string;
  photographer_id: string;
  amount_cents: number;
  status: PayoutStatus;
  admin_notes: string | null;
  payment_account_id: string | null;
  stripe_transfer_id: string | null;
  stripe_charge_id: string | null;
  currency: string | null;
  hold_reason: PayoutHoldReason | null;
  order_id: string | null;
  order_kind: PayoutOrderKind | null;
  transfer_batch_id: string | null;
  /** Running total clawed back from this payout (T-215). 0 for untouched rows. */
  reversed_amount_cents: number;
  stripe_reversal_id: string | null;
  reversed_at: string | null;
  void_reason: PayoutVoidReason | null;
  /** The dispute whose opening froze this row (T-215). Null unless frozen. */
  frozen_by_dispute_id: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
}

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Get payouts for a photographer
 */
export async function getPayouts(
  supabase: SupabaseServerClient,
  photographerId: string,
  status?: PayoutStatus,
  limit = 50,
): Promise<Payout[]> {
  let query = supabase
    .from('payouts')
    .select('*')
    .eq('photographer_id', photographerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get payouts: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as Payout[];
}

/**
 * Get a single payout by ID
 */
export async function getPayout(
  supabase: SupabaseServerClient,
  payoutId: string,
  photographerId: string,
): Promise<Payout | null> {
  const { data, error } = await supabase
    .from('payouts')
    .select('*')
    .eq('id', payoutId)
    .eq('photographer_id', photographerId)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get payout: ${getErrorMessage(error)}`);
  }

  return data as Payout | null;
}

/**
 * Create a new payout request
 */
export async function createPayout(
  supabase: SupabaseServerClient,
  photographerId: string,
  amountCents: number,
  paymentAccountId: string,
): Promise<Payout> {
  const { data, error } = await supabase
    .from('payouts')
    .insert({
      photographer_id: photographerId,
      amount_cents: amountCents,
      payment_account_id: paymentAccountId,
      status: 'pending',
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create payout: ${getErrorMessage(error)}`);
  }

  return data as Payout;
}

/**
 * Update payout status (admin function)
 */
export async function updatePayoutStatus(
  supabase: SupabaseServerClient,
  payoutId: string,
  status: PayoutStatus,
  adminNotes?: string,
): Promise<Payout> {
  const updateData: Partial<Payout> = { status };
  if (adminNotes !== undefined) {
    updateData.admin_notes = adminNotes;
  }

  const { data, error } = await supabase
    .from('payouts')
    .update(updateData)
    .eq('id', payoutId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update payout status: ${getErrorMessage(error)}`);
  }

  return data as Payout;
}

/**
 * Log an already-completed Stripe transfer as a paid payout.
 *
 * ⚠️ **`stripe_charge_id` is required, and a unique violation is NOT benign
 * here (T-216).** Before T-216 idempotency rested on `UNIQUE(stripe_transfer_id)`
 * and a 23505 meant "same transfer already logged" — harmless. That constraint is
 * gone (one aggregated transfer legitimately settles several rows), so the only
 * uniqueness left is `(stripe_charge_id, photographer_id)`. A 23505 now means a
 * row for this money already existed *before* we transferred, i.e. we probably
 * just paid the same sale twice. Swallowing it would delete the only evidence.
 *
 * It is not thrown either — the transfer really happened and failing the webhook
 * would make Stripe redeliver and compound the problem — but it is logged loudly
 * so it surfaces rather than vanishing.
 *
 * Prefer `openPayoutRow` + `settlePayoutPaid`, which reserve the row *before*
 * calling Stripe and therefore prevent the second payment instead of reporting
 * it. This function remains for the paid path that has no reservation.
 */
export async function createPayoutFromTransfer(
  supabase: SupabaseServerClient,
  params: {
    photographer_id: string;
    amount_cents: number;
    stripe_transfer_id: string;
    stripe_charge_id: string;
    currency?: string | null;
    order_id?: string | null;
    order_kind?: PayoutOrderKind | null;
  },
): Promise<void> {
  const { error } = await supabase.from('payouts').insert({
    photographer_id: params.photographer_id,
    amount_cents: params.amount_cents,
    stripe_transfer_id: params.stripe_transfer_id,
    stripe_charge_id: params.stripe_charge_id,
    currency: params.currency ?? null,
    order_id: params.order_id ?? null,
    order_kind: params.order_kind ?? null,
    status: 'paid',
    paid_at: new Date().toISOString(),
  });

  if (error?.code === UNIQUE_VIOLATION) {
    console.error(
      `[payouts] POSSIBLE DOUBLE PAYMENT: transfer ${params.stripe_transfer_id} completed for ` +
        `photographer ${params.photographer_id} on charge ${params.stripe_charge_id}, but a payout ` +
        'row for that (charge, photographer) already existed. Reconcile against Stripe.',
    );
    return;
  }

  if (error) {
    throw new Error(`Failed to log payout from transfer: ${getErrorMessage(error)}`);
  }
}

/**
 * Reserve the row for a photographer's share of one charge — **before** any
 * Stripe call (T-216).
 *
 * This is the concurrency primitive of the whole ledger. The partial unique
 * index on `(stripe_charge_id, photographer_id)` means exactly one writer can
 * create this row; everyone else gets a 23505 and must transfer **nothing**.
 * Returning `null` rather than throwing is what makes that a normal control-flow
 * outcome ("someone else owns this money") instead of an error.
 *
 * Pass a `hold_reason` when we already know no transfer will be attempted — the
 * row lands `pending` and the retry worker owns it from there. Omit it to
 * reserve the row `processing` for a transfer we are about to make.
 */
export async function openPayoutRow(
  supabase: SupabaseServerClient,
  params: {
    photographer_id: string;
    amount_cents: number;
    currency: string;
    stripe_charge_id: string;
    order_id?: string | null;
    order_kind?: PayoutOrderKind | null;
    hold_reason?: PayoutHoldReason | null;
  },
): Promise<Payout | null> {
  const { data, error } = await supabase
    .from('payouts')
    .insert({
      photographer_id: params.photographer_id,
      amount_cents: params.amount_cents,
      currency: params.currency,
      stripe_charge_id: params.stripe_charge_id,
      order_id: params.order_id ?? null,
      order_kind: params.order_kind ?? null,
      hold_reason: params.hold_reason ?? null,
      status: params.hold_reason ? 'pending' : 'processing',
    })
    .select()
    .maybeSingle();

  if (error?.code === UNIQUE_VIOLATION) return null;

  if (error) {
    throw new Error(`Failed to open payout row: ${getErrorMessage(error)}`);
  }

  return (data as Payout | null) ?? null;
}

/**
 * Mark a reserved row paid.
 *
 * ⚠️ `paid_at` is deliberately not passed: `set_payouts_paid_at` is a BEFORE
 * UPDATE trigger that overwrites it with `now()` on any transition into `paid`,
 * so the transfer's own timestamp cannot be stored here. `stripe_transfer_id`
 * stays the join key for reconciliation against Stripe.
 */
export async function settlePayoutPaid(
  supabase: SupabaseServerClient,
  payoutId: string,
  stripeTransferId: string,
): Promise<void> {
  const { error } = await supabase
    .from('payouts')
    .update({ status: 'paid', stripe_transfer_id: stripeTransferId, hold_reason: null })
    .eq('id', payoutId);

  if (error) {
    throw new Error(`Failed to settle payout: ${getErrorMessage(error)}`);
  }
}

/**
 * Park a reserved row as an outstanding hold the retry worker will pick up.
 *
 * Only moves rows that are not already settled, so a late failure can never
 * demote a payout that actually went out.
 */
export async function holdPayoutRow(
  supabase: SupabaseServerClient,
  payoutId: string,
  reason: PayoutHoldReason,
): Promise<void> {
  const { error } = await supabase
    .from('payouts')
    .update({ status: 'pending', hold_reason: reason })
    .eq('id', payoutId)
    .in('status', ['pending', 'processing']);

  if (error) {
    throw new Error(`Failed to hold payout: ${getErrorMessage(error)}`);
  }
}

/**
 * Outstanding debts the retry worker may pay.
 *
 * ⚠️ The `hold_reason`/`stripe_charge_id` filter is a **security** filter, not a
 * tidiness one. The `payouts` table has carried a `pending` status since 2025,
 * and until T-216 an RLS policy let photographers INSERT their own rows. Those
 * legacy rows have neither field set, so filtering on both makes them
 * structurally unpayable — without depending on a data migration having run.
 */
export async function listPayableHolds(
  supabase: SupabaseServerClient,
  limit = 500,
): Promise<Payout[]> {
  const { data, error } = await supabase
    .from('payouts')
    .select('*')
    .eq('status', 'pending')
    .not('hold_reason', 'is', null)
    .not('stripe_charge_id', 'is', null)
    // ⚠️ A hold frozen by an open INQUIRY stays `pending` on purpose — that is what
    // keeps it inside `getTotalPendingPayouts` and therefore out of the
    // photographer's withdrawable balance. `pending` alone is no longer the same
    // question as "may we send this"; the freeze is.
    .is('frozen_by_dispute_id', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list payable holds: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as Payout[];
}

/**
 * Claim a set of sub-minimum rows into one batch.
 *
 * `status = 'pending'` in the WHERE is what makes this atomic: under READ
 * COMMITTED Postgres re-evaluates the predicate after taking the row lock, so
 * two concurrent claimers get **disjoint** sets rather than both seeing the same
 * rows. The caller must therefore recompute the transfer amount from what comes
 * back here — never from the rows it read before claiming.
 */
export async function claimPayoutsForBatch(
  supabase: SupabaseServerClient,
  payoutIds: string[],
  batchId: string,
): Promise<Payout[]> {
  if (payoutIds.length === 0) return [];

  const { data, error } = await supabase
    .from('payouts')
    .update({ status: 'processing', transfer_batch_id: batchId })
    .in('id', payoutIds)
    .eq('status', 'pending')
    // Re-asserted here as well as in the read: a dispute may have frozen the row
    // between listing it and claiming it, and the claim is the last moment before
    // a Stripe call.
    .is('frozen_by_dispute_id', null)
    .select();

  if (error) {
    throw new Error(`Failed to claim payouts for batch: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as Payout[];
}

/**
 * Hand a claimed batch back when it turned out to be unpayable and **no Stripe
 * call was made against it**.
 *
 * Safe only under that condition. If a transfer was issued, the rows must stay
 * `processing` so the re-drive reuses the same batch id and idempotency key;
 * releasing them would let a later run build a different batch for money Stripe
 * may already have moved.
 */
export async function releaseClaimedPayouts(
  supabase: SupabaseServerClient,
  batchId: string,
  reason: PayoutHoldReason,
): Promise<void> {
  const { error } = await supabase
    .from('payouts')
    .update({ status: 'pending', transfer_batch_id: null, hold_reason: reason })
    .eq('transfer_batch_id', batchId)
    .eq('status', 'processing');

  if (error) {
    throw new Error(`Failed to release claimed payouts: ${getErrorMessage(error)}`);
  }
}

/** Mark every row of a batch paid against the transfer that settled it. */
export async function settleBatchAsPaid(
  supabase: SupabaseServerClient,
  batchId: string,
  stripeTransferId: string,
): Promise<void> {
  const { error } = await supabase
    .from('payouts')
    .update({ status: 'paid', stripe_transfer_id: stripeTransferId, hold_reason: null })
    .eq('transfer_batch_id', batchId)
    .eq('status', 'processing');

  if (error) {
    throw new Error(`Failed to settle payout batch: ${getErrorMessage(error)}`);
  }
}

/**
 * Claim ONE row for an individual transfer, the way {@link claimPayoutsForBatch}
 * claims a group (T-215).
 *
 * ⚠️ This closes a real double-payment window, not a theoretical one. The row used
 * to stay `pending` across its own Stripe call, so a run that transferred and then
 * failed to write `settlePayoutPaid` left a paid row looking unpaid. Within 24h the
 * idempotency key replays Stripe's original answer and hides it — but the key
 * expires and the row does not, so the next tick after that sends the money a
 * SECOND time. `source_transaction` only refuses an over-draw of the charge, which
 * a single share of a multi-photographer order can still fit inside.
 *
 * Claiming first makes the row invisible to later ticks; if the process dies
 * mid-flight, the stale-single recovery in the retry worker probes Stripe and
 * either settles the row or hands it back as a hold.
 *
 * Returns `null` when the row was not claimable — already claimed, already paid,
 * or frozen by a dispute between the read and here.
 */
export async function claimPayoutForTransfer(
  supabase: SupabaseServerClient,
  payoutId: string,
): Promise<Payout | null> {
  const { data, error } = await supabase
    .from('payouts')
    .update({ status: 'processing' })
    .eq('id', payoutId)
    .eq('status', 'pending')
    .is('frozen_by_dispute_id', null)
    .select();

  if (error) {
    throw new Error(`Failed to claim payout for transfer: ${getErrorMessage(error)}`);
  }

  return ((data ?? [])[0] as Payout | undefined) ?? null;
}

/** Batches left mid-flight past the staleness window, oldest first. */
export async function listStaleProcessingBatches(
  supabase: SupabaseServerClient,
  staleBeforeIso: string,
  limit = 50,
): Promise<Payout[]> {
  const { data, error } = await supabase
    .from('payouts')
    .select('*')
    .eq('status', 'processing')
    .not('transfer_batch_id', 'is', null)
    .lt('updated_at', staleBeforeIso)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list stale processing batches: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as Payout[];
}

/**
 * Individually-claimed rows left mid-flight past the staleness window (T-215).
 *
 * The mirror of {@link listStaleProcessingBatches} for rows claimed by
 * {@link claimPayoutForTransfer}, told apart by having NO batch id. Without this
 * the claim would trade a double-payment window for a permanent one: a row stuck
 * `processing` is invisible to `listPayableHolds` and no other sweep looks for it.
 */
export async function listStaleProcessingSingles(
  supabase: SupabaseServerClient,
  staleBeforeIso: string,
  limit = 50,
): Promise<Payout[]> {
  const { data, error } = await supabase
    .from('payouts')
    .select('*')
    .eq('status', 'processing')
    .is('transfer_batch_id', null)
    .lt('updated_at', staleBeforeIso)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list stale processing payouts: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as Payout[];
}

export interface HoldReductionOutcome {
  /** Holds moved to their reversal target (a full reversal voids the row). */
  applied: number;
  /** Holds voided outright because the whole charge came back. */
  voided: number;
  /** Rows a human must look at — nothing was changed for these. */
  needsReview: number;
}

/**
 * Move the money that has NOT been sent yet to its reversal target
 * (T-216, redesigned by T-215/T-237).
 *
 * Without this, T-216 would CREATE a loss the pre-ledger code does not have: a
 * stranded hold is accidentally protected by being stranded, but once a worker
 * pays holds it would happily send a refunded buyer's money to the photographer.
 *
 * ⚠️ **`amount_cents` is never written here — it is immutable after insert.** The
 * reduction lives in `reversed_amount_cents`, and the payable amount is
 * `amount_cents - reversed_amount_cents` everywhere. Two bugs die with that rule:
 *
 *   - **Redelivery.** The previous version reduced the CURRENT amount by a
 *     proportion of the CUMULATIVE refund, so each of Stripe's redeliveries (up to
 *     three days, and routine here) reduced it again — 2000 → 1500 → 1125 → 844 on
 *     one €5 refund, irrecoverably, since the exactly-once index blocks writing a
 *     replacement row. Moving to a target is idempotent.
 *   - **The spent idempotency key.** A `transfer_failed` row already made a Stripe
 *     call under `payout_<id>` at its original amount; the retry worker's recovery
 *     probe matches on that EXACT amount. Preserving `amount_cents` keeps the probe
 *     able to recognise the transfer that was really made.
 *
 * Only `pending` rows are touched. A `processing` row may have a transfer in
 * flight; reversing that belongs to the clawback orchestrator, which probes Stripe
 * before acting.
 *
 * `voidReason` is recorded for the audit trail. It is NOT how a won dispute
 * restores a freeze — that is scoped by `frozen_by_dispute_id`, so the two
 * mechanisms cannot interfere.
 */
export async function applyReversalToHolds(
  supabase: SupabaseServerClient,
  params: {
    stripeChargeId: string;
    target: ClawbackTarget;
    voidReason: PayoutVoidReason;
  },
): Promise<HoldReductionOutcome> {
  const { stripeChargeId, target, voidReason } = params;

  const { data: holds, error } = await supabase
    .from('payouts')
    .select('id, amount_cents, reversed_amount_cents, hold_reason')
    .eq('stripe_charge_id', stripeChargeId)
    .eq('status', 'pending');

  if (error) {
    throw new Error(`Failed to load holds for charge: ${getErrorMessage(error)}`);
  }

  const outcome: HoldReductionOutcome = { applied: 0, voided: 0, needsReview: 0 };

  for (const hold of (holds ?? []) as Array<{
    id: string;
    amount_cents: number;
    reversed_amount_cents: number | null;
    hold_reason: PayoutHoldReason | null;
  }>) {
    const alreadyReversed = hold.reversed_amount_cents ?? 0;
    const targetForRow = targetReversedCents(hold.amount_cents, target);
    if (targetForRow <= alreadyReversed) continue;

    const fullyReversed = targetForRow >= hold.amount_cents;

    // ⚠️ A `transfer_failed` row cannot be PARTIALLY clawed back. Its idempotency
    // key is spent at the original amount, so the worker could only ever re-send
    // that amount — more than is now owed. Voiding it is the recoverable
    // direction (the row can be restored by UPDATE); a human decides whether the
    // photographer is still owed the unreversed part.
    const cannotPartiallyReduce = hold.hold_reason === 'transfer_failed' && !fullyReversed;

    const update = cannotPartiallyReduce
      ? {
          status: 'cancelled' as const,
          void_reason: voidReason,
          admin_notes: `T-215: voided for review — ${target.reversedCents} of ${target.chargeTotalCents} cents was ${voidReason === 'dispute' ? 'disputed' : 'refunded'}, but this hold's Stripe idempotency key is already spent at ${hold.amount_cents} cents and cannot be partially reduced.`,
        }
      : {
          reversed_amount_cents: targetForRow,
          reversed_at: new Date().toISOString(),
          ...(fullyReversed
            ? {
                status: 'cancelled' as const,
                void_reason: voidReason,
                admin_notes: `T-215: voided — the originating charge was ${voidReason === 'dispute' ? 'disputed' : 'refunded'} in full.`,
              }
            : {
                admin_notes: `T-215: ${targetForRow} of ${hold.amount_cents} cents clawed back — ${target.reversedCents} of ${target.chargeTotalCents} cents was ${voidReason === 'dispute' ? 'disputed' : 'refunded'}.`,
              }),
        };

    // ⚠️ `.select()` is load-bearing: re-asserting `pending` without checking what
    // matched let a row the retry worker had already claimed be REPORTED as
    // neutralised while the worker went on to pay it.
    const { data: updated, error: updateError } = await supabase
      .from('payouts')
      .update(update)
      .eq('id', hold.id)
      .eq('status', 'pending')
      .select('id');

    if (updateError) {
      throw new Error(`Failed to apply reversal to hold: ${getErrorMessage(updateError)}`);
    }

    if ((updated ?? []).length === 0) {
      // The worker claimed it between our read and our write, so it may be paying
      // right now. Nothing was changed and nobody may assume otherwise.
      outcome.needsReview += 1;
      continue;
    }

    if (cannotPartiallyReduce) outcome.needsReview += 1;
    else if (fullyReversed) outcome.voided += 1;
    else outcome.applied += 1;
  }

  return outcome;
}

/**
 * Stop every outstanding hold for a charge from being paid while a dispute is
 * open (T-215).
 *
 * Distinct from {@link applyReversalToHolds} on purpose: an open dispute puts the
 * WHOLE charge in question, so there is no proportion to compute and no charge
 * total to look up. Expressing "freeze it all" as a fake full reversal would mean
 * passing `dispute.amount` as both the reversed amount and the charge total — the
 * exact conflation that made a partial dispute claw back 100% of a payout.
 *
 * ## ⚠️ Whether the row leaves `pending` follows ACCESS, and is not a free choice
 *
 * The photographer's balance is `withdrawable = net − paidOut − pending`, so a
 * hold must sit in `pending` exactly while its sale sits in `net`. `net` counts
 * `completed` orders, and this app revokes access by moving the order off
 * `completed` — so the two have to move together:
 *
 *   - **A real chargeback** revokes access, dropping the sale out of `net`. The
 *     hold must leave `pending` too, or the same money is subtracted twice and the
 *     difference is eaten out of that photographer's OTHER earnings.
 *   - **An inquiry** deliberately leaves access alone, so the sale stays in `net`
 *     and the hold must stay in `pending`. Cancelling it here — which is what this
 *     function used to do for both — took the hold out of `pending` while the sale
 *     stayed in `net`, so *opening an inquiry RAISED the photographer's
 *     withdrawable balance* by exactly the amount that had just been frozen. The
 *     precise opposite of freezing.
 *
 * Either way the row is marked with `frozen_by_dispute_id`, and that mark — not
 * the status — is what {@link listPayableHolds} refuses to pay.
 */
export async function freezeHoldsForCharge(
  supabase: SupabaseServerClient,
  stripeChargeId: string,
  disputeId: string,
  /** True for a real chargeback (access is being revoked), false for an inquiry. */
  options: { revokesAccess: boolean },
): Promise<number> {
  const { data, error } = await supabase
    .from('payouts')
    .update({
      frozen_by_dispute_id: disputeId,
      ...(options.revokesAccess
        ? {
            status: 'cancelled' as const,
            void_reason: 'dispute' as const,
            admin_notes: `T-215: frozen and voided — chargeback ${disputeId} was opened against this charge, and the sale left the photographer's earnings with it.`,
          }
        : {
            admin_notes: `T-215: frozen — inquiry ${disputeId} was opened against this charge. The row stays 'pending' so the photographer's balance does not move; it is simply not payable.`,
          }),
    })
    .eq('stripe_charge_id', stripeChargeId)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    throw new Error(`Failed to freeze holds for charge: ${getErrorMessage(error)}`);
  }

  return (data ?? []).length;
}

/**
 * Un-void the holds a dispute voided, because the dispute was WON (T-215).
 *
 * Scoped to `void_reason = 'dispute'` so a hold voided by an actual refund on the
 * same charge stays voided — the buyer really did get that money back.
 *
 * This is possible at all because the exactly-once index on
 * `(stripe_charge_id, photographer_id)` constrains INSERTs, not UPDATEs: the row
 * never went away, so restoring it is a status change rather than the impossible
 * re-creation T-237 assumed.
 */
export async function restoreHoldsForCharge(
  supabase: SupabaseServerClient,
  stripeChargeId: string,
  disputeId: string,
): Promise<number> {
  // A freeze now has two shapes, so releasing it has two steps. Both are scoped to
  // THIS dispute id: matching on `void_reason` alone resurrected holds voided by a
  // real refund — settling a chargeback by refunding, then winning it, paid the
  // photographer for a sale the buyer got back in full.

  // 1. Rows a CHARGEBACK voided. Only these may return to `pending`, and only when
  //    the freeze is what voided them — `void_reason = 'refund'` means the buyer
  //    really did get that money back, and winning a dispute does not undo it.
  const { data: unvoided, error: unvoidError } = await supabase
    .from('payouts')
    .update({
      status: 'pending',
      void_reason: null,
      frozen_by_dispute_id: null,
      admin_notes: `T-215: unfrozen — dispute ${disputeId} closed without loss.`,
    })
    .eq('stripe_charge_id', stripeChargeId)
    .eq('frozen_by_dispute_id', disputeId)
    .eq('status', 'cancelled')
    .eq('void_reason', 'dispute')
    .select('id');

  if (unvoidError) {
    throw new Error(`Failed to restore holds for charge: ${getErrorMessage(unvoidError)}`);
  }

  // 2. Everything else this dispute froze: rows an INQUIRY left `pending`, plus any
  //    the refund path voided while frozen. Clearing the mark is the whole release —
  //    their status was never the freeze and must not be rewritten by it.
  const { data: unmarked, error: unmarkError } = await supabase
    .from('payouts')
    .update({ frozen_by_dispute_id: null })
    .eq('stripe_charge_id', stripeChargeId)
    .eq('frozen_by_dispute_id', disputeId)
    .select('id');

  if (unmarkError) {
    throw new Error(`Failed to release the dispute freeze: ${getErrorMessage(unmarkError)}`);
  }

  return (unvoided ?? []).length + (unmarked ?? []).length;
}

/**
 * Rows for a charge that represent money already sent, or possibly sent (T-215).
 *
 * `paid` rows carry a transfer to reverse. `processing` rows are the ambiguous
 * ones — a transfer may or may not exist at Stripe — which is why the caller
 * probes before touching them rather than assuming either way.
 *
 * A fully `reversed` row is deliberately included: a later, larger partial refund
 * legitimately computes a delta of 0 for it, and excluding it would hide it from
 * the reconciliation view for no gain.
 */
export async function listReversibleRowsForCharge(
  supabase: SupabaseServerClient,
  stripeChargeId: string,
): Promise<Payout[]> {
  const { data, error } = await supabase
    .from('payouts')
    .select('*')
    .eq('stripe_charge_id', stripeChargeId)
    .in('status', ['paid', 'processing', 'reversed'])
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to list reversible payouts for charge: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as Payout[];
}

/**
 * Reserve a reversal BEFORE calling Stripe (T-215).
 *
 * ⚠️ **Ordering matters exactly as much as it does for `openPayoutRow`.** If the
 * Stripe call came first and the write after it failed, `reversed_amount_cents`
 * would stay behind the money actually pulled back — and because the idempotency
 * key encodes the CUMULATIVE refunded amount, the next partial refund arrives with
 * a DIFFERENT key, so Stripe does not dedupe it and the delta is reversed twice.
 * The photographer is over-clawed and `getTotalPaidOut` reports a balance higher
 * than the money they hold.
 *
 * Reserving first inverts the failure: a crash between the reservation and the
 * Stripe call leaves the row claiming MORE was reversed than was, so a later
 * reversal computes a smaller delta. We under-claw rather than over-claw — the
 * photographer keeps money the platform may be owed, which is visible in
 * reconciliation and recoverable, instead of losing money they were never
 * charged for.
 *
 * Returns the reserved total so the caller can confirm it afterwards.
 */
export async function reservePayoutReversal(
  supabase: SupabaseServerClient,
  payoutId: string,
  reversedCents: number,
): Promise<number> {
  const { data: current, error: readError } = await supabase
    .from('payouts')
    .select('amount_cents, reversed_amount_cents')
    .eq('id', payoutId)
    .maybeSingle();

  if (readError || !current) {
    throw new Error(`Failed to read payout for reversal: ${getErrorMessage(readError)}`);
  }

  const row = current as { amount_cents: number; reversed_amount_cents: number | null };
  const totalReversed = Math.min(
    row.amount_cents,
    (row.reversed_amount_cents ?? 0) + Math.max(0, reversedCents),
  );

  const { error } = await supabase
    .from('payouts')
    .update({
      reversed_amount_cents: totalReversed,
      reversed_at: new Date().toISOString(),
      ...(totalReversed >= row.amount_cents ? { status: 'reversed' as const } : {}),
    })
    .eq('id', payoutId);

  if (error) {
    throw new Error(`Failed to reserve payout reversal: ${getErrorMessage(error)}`);
  }

  return totalReversed;
}

/**
 * Release a reservation whose Stripe call failed (T-215).
 *
 * Best-effort by nature: if this also fails the row simply over-reports the
 * reversal, which is the safe direction (we claw back less next time, never more).
 */
export async function releasePayoutReversal(
  supabase: SupabaseServerClient,
  payoutId: string,
  reversedCents: number,
): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from('payouts')
    .select('amount_cents, reversed_amount_cents, stripe_transfer_id')
    .eq('id', payoutId)
    .maybeSingle();

  if (readError || !current) {
    console.error(`[payouts] could not read payout ${payoutId} to release its reversal`);
    return;
  }

  const row = current as {
    amount_cents: number;
    reversed_amount_cents: number | null;
    stripe_transfer_id: string | null;
  };
  const released = Math.max(0, (row.reversed_amount_cents ?? 0) - Math.max(0, reversedCents));

  // ⚠️ The status is DERIVED, never restored from a captured value. Taking a
  // `previousStatus` argument wrote back the status read before the row was
  // settled, so a failed reversal on a transfer we had just confirmed rewrote a
  // `paid` row to `processing` — money that provably left the platform stopped
  // counting in `getTotalPaidOut`, overstating the photographer's balance.
  const { error } = await supabase
    .from('payouts')
    .update({
      reversed_amount_cents: released,
      status: released >= row.amount_cents ? 'reversed' : 'paid',
    })
    .eq('id', payoutId);

  if (error) {
    console.error(`[payouts] failed to release reversal on ${payoutId}:`, error);
  }
}

/**
 * Reversals we recorded but never confirmed with Stripe (T-215).
 *
 * `reservePayoutReversal` writes before the Stripe call — deliberately, so a
 * failure claws back LESS rather than more — which means a process killed in
 * between leaves a row claiming money came back when it never did. Nothing else
 * would ever notice: the target maths sees `already == target` and does nothing,
 * while `getTotalPaidOut` deducts money still sitting in the photographer's Stripe
 * account. This is the sweep that makes the docstring's "visible in
 * reconciliation" true.
 */
export async function listUnconfirmedReversals(
  supabase: SupabaseServerClient,
  staleBeforeIso: string,
  limit = 100,
): Promise<Payout[]> {
  const { data, error } = await supabase
    .from('payouts')
    .select('*')
    .not('reversed_at', 'is', null)
    .is('stripe_reversal_id', null)
    .lt('reversed_at', staleBeforeIso)
    .order('reversed_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list unconfirmed reversals: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as Payout[];
}

/**
 * Confirm a reserved reversal by attaching Stripe's reversal id (T-215).
 *
 * The amount was already committed by {@link reservePayoutReversal}; this only
 * records the pointer for tracing. `reversed_at` is set by the reservation rather
 * than by a trigger (unlike `paid_at`) because a partial reversal is not a status
 * transition, so a trigger keyed on status could not see it.
 */
export async function confirmPayoutReversal(
  supabase: SupabaseServerClient,
  payoutId: string,
  stripeReversalId: string | null,
): Promise<void> {
  if (!stripeReversalId) return;

  const { error } = await supabase
    .from('payouts')
    .update({ stripe_reversal_id: stripeReversalId })
    .eq('id', payoutId);

  if (error) {
    // The money is already reversed and already accounted for; losing the
    // pointer is a tracing inconvenience, not a ledger error.
    console.error(`[payouts] failed to attach reversal id to ${payoutId}:`, error);
  }
}

/**
 * Money that actually reached a photographer and stayed there.
 *
 * ⚠️ **Net of clawbacks (T-215), and it has to be.** `getEarningsSummary` computes
 * `withdrawable = net − paidOut − pending`. When a sale is refunded or its dispute
 * lost, its order stops being `completed`, so it leaves `net` — if `paidOut` did
 * not fall by the reversed amount at the same time, the photographer's
 * withdrawable balance would be understated by exactly that money, permanently
 * and invisibly.
 */
export async function getTotalPaidOut(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('payouts')
    .select('amount_cents, reversed_amount_cents')
    .eq('photographer_id', photographerId)
    // `reversed` rows are fully clawed back, so they contribute 0 — but they must
    // still be SELECTED, because a partially reversed row keeps status `paid` and
    // has to contribute its unreversed remainder.
    .in('status', ['paid', 'reversed']);

  if (error) {
    throw new Error(`Failed to get total paid out: ${getErrorMessage(error)}`);
  }

  return (data ?? []).reduce(
    (sum, payout) => sum + payout.amount_cents - (payout.reversed_amount_cents ?? 0),
    0,
  );
}

/**
 * Money owed to a photographer that has not landed yet.
 *
 * ⚠️ **`processing` must be in this list (T-216).** `getEarningsSummary` computes
 * `withdrawableBalanceCents = net − paidOut − pending`, so a status counted by
 * neither `getTotalPaidOut` (`paid`) nor this function inflates the withdrawable
 * balance by exactly its amount — presenting money that is mid-transfer, or
 * wedged, as available.
 */
export async function getTotalPendingPayouts(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('payouts')
    .select('amount_cents, reversed_amount_cents')
    .eq('photographer_id', photographerId)
    .in('status', ['pending', 'approved', 'processing']);

  if (error) {
    throw new Error(`Failed to get pending payouts: ${getErrorMessage(error)}`);
  }

  // Net of clawbacks, for the same reason `getTotalPaidOut` is. `amount_cents` is
  // immutable now, so a partially clawed-back hold no longer shrinks its own
  // column — without this subtraction the withdrawable balance would be
  // understated by exactly the reversed amount, the mirror of the bug the
  // `getTotalPaidOut` docstring exists to prevent.
  return (data ?? []).reduce(
    (sum, payout) => sum + payout.amount_cents - (payout.reversed_amount_cents ?? 0),
    0,
  );
}
