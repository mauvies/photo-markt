/**
 * Payouts-related database queries
 * For tracking photographer payout requests and processing
 */

import { computeReducedHoldCents } from '@/lib/payouts/clawback';
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

export interface HoldReductionOutcome {
  /** Holds voided outright (a full reversal, or nothing payable left). */
  voided: number;
  /** Holds kept with a smaller amount (a partial reversal). */
  reduced: number;
  /**
   * Holds voided because their amount could NOT safely be changed — a
   * `transfer_failed` row, whose Stripe idempotency key is already spent. A human
   * decides whether the photographer is still owed the unrefunded remainder.
   */
  frozenForReview: number;
}

/**
 * Apply a refund or a lost dispute to the money that has NOT been sent yet
 * (T-216, corrected by T-215/T-237).
 *
 * Without this, T-216 would CREATE a loss the pre-ledger code does not have: a
 * stranded hold is accidentally protected by being stranded, but once a worker
 * pays holds it would happily send a refunded buyer's money to the photographer.
 *
 * ⚠️ **This used to void the whole hold on ANY `charge.refunded` — including a
 * partial one.** Stripe fires that event for partial refunds too, so refunding
 * €5 of a €20 sale destroyed the photographer's net on the remaining €15, and
 * destroyed it *irrecoverably*: the partial unique index on
 * `(stripe_charge_id, photographer_id)` blocks inserting a replacement row. Now a
 * partial reversal REDUCES the hold proportionally (`computeReducedHoldCents`)
 * and only a full one voids it.
 *
 * Only `pending` rows are touched here. A `processing` row may already have a
 * transfer in flight at Stripe; reversing that is the other half of the clawback
 * and belongs to `applyClawback`, which probes Stripe before acting — silently
 * cancelling it here would desync the ledger from Stripe.
 *
 * `voidReason` is stored so a WON dispute can restore exactly what it voided
 * (see {@link restoreHoldsForCharge}).
 */
export async function applyReversalToHolds(
  supabase: SupabaseServerClient,
  params: {
    stripeChargeId: string;
    /** CUMULATIVE amount reversed on the charge. */
    reversedCents: number;
    /** The charge total, fee included. */
    chargeCents: number;
    voidReason: PayoutVoidReason;
  },
): Promise<HoldReductionOutcome> {
  const { stripeChargeId, reversedCents, chargeCents, voidReason } = params;

  const { data: holds, error } = await supabase
    .from('payouts')
    .select('id, amount_cents, hold_reason')
    .eq('stripe_charge_id', stripeChargeId)
    .eq('status', 'pending');

  if (error) {
    throw new Error(`Failed to load holds for charge: ${getErrorMessage(error)}`);
  }

  const outcome: HoldReductionOutcome = { voided: 0, reduced: 0, frozenForReview: 0 };

  for (const hold of (holds ?? []) as Array<{
    id: string;
    amount_cents: number;
    hold_reason: PayoutHoldReason | null;
  }>) {
    const survivor = computeReducedHoldCents({
      amountCents: hold.amount_cents,
      reversedCents,
      chargeCents,
    });

    // ⚠️ **A `transfer_failed` row's amount is frozen — it must never be reduced.**
    // It is the one hold reason created AFTER a Stripe call, so its idempotency
    // key `payout_<id>` has already been spent at the original amount. Change the
    // amount and the retry worker replays that same key with a different body:
    // Stripe 400s for the key's whole 24-hour life (indistinguishable from an
    // outage in the logs) and then, once the key expires, issues a genuine SECOND
    // transfer. The worker's recovery probe cannot save it either, because
    // `findTransferByGroup` matches on the exact amount and would no longer
    // recognise the transfer that was really made.
    //
    // So a partial reversal voids these instead. Not sending money is the
    // recoverable direction — the row can be restored by UPDATE if a human decides
    // the photographer is still owed the unrefunded part — whereas a wedged-then-
    // double-paid transfer is not.
    const keyAlreadySpent = hold.hold_reason === 'transfer_failed';
    const mustFreeze = keyAlreadySpent && survivor !== null;

    const update =
      survivor === null || mustFreeze
        ? {
            status: 'cancelled' as const,
            void_reason: voidReason,
            admin_notes: mustFreeze
              ? `T-215: voided for review — a partial ${voidReason} (${reversedCents} of ${chargeCents} cents) cannot reduce a transfer_failed hold, whose Stripe idempotency key is already spent at ${hold.amount_cents} cents.`
              : `T-215: voided — the originating charge was ${
                  voidReason === 'dispute' ? 'disputed' : 'refunded'
                } in full.`,
          }
        : {
            amount_cents: survivor,
            admin_notes: `T-215: reduced from ${hold.amount_cents} to ${survivor} cents — ${reversedCents} of ${chargeCents} cents was ${
              voidReason === 'dispute' ? 'disputed' : 'refunded'
            }.`,
          };

    const { error: updateError } = await supabase
      .from('payouts')
      .update(update)
      // Re-assert `pending`: the retry worker may have claimed this row into
      // `processing` between the read above and here, and a claimed row has a
      // Stripe call in flight against it.
      .eq('id', hold.id)
      .eq('status', 'pending');

    if (updateError) {
      throw new Error(`Failed to apply reversal to hold: ${getErrorMessage(updateError)}`);
    }

    if (mustFreeze) outcome.frozenForReview += 1;
    else if (survivor === null) outcome.voided += 1;
    else outcome.reduced += 1;
  }

  return outcome;
}

/**
 * Void every outstanding hold for a charge while a dispute is open (T-215).
 *
 * Distinct from {@link applyReversalToHolds} on purpose: an open dispute puts the
 * WHOLE charge in question, so there is no proportion to compute and no charge
 * total to look up. Expressing "freeze it all" as a fake full reversal would mean
 * passing `dispute.amount` as both the reversed amount and the charge total — the
 * exact conflation that made a partial dispute claw back 100% of a payout.
 *
 * Reversible because it is scoped by `void_reason`: winning restores precisely
 * these rows (see {@link restoreHoldsForCharge}).
 */
export async function freezeHoldsForCharge(
  supabase: SupabaseServerClient,
  stripeChargeId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('payouts')
    .update({
      status: 'cancelled',
      void_reason: 'dispute',
      admin_notes: 'T-215: frozen — a chargeback was opened against this charge.',
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
): Promise<number> {
  const { data, error } = await supabase
    .from('payouts')
    .update({
      status: 'pending',
      void_reason: null,
      admin_notes: 'T-215: restored — the dispute was won.',
    })
    .eq('stripe_charge_id', stripeChargeId)
    .eq('status', 'cancelled')
    .eq('void_reason', 'dispute')
    .select('id');

  if (error) {
    throw new Error(`Failed to restore holds for charge: ${getErrorMessage(error)}`);
  }

  return (data ?? []).length;
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
  previousStatus: PayoutStatus,
): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from('payouts')
    .select('reversed_amount_cents')
    .eq('id', payoutId)
    .maybeSingle();

  if (readError || !current) return;

  const held = (current as { reversed_amount_cents: number | null }).reversed_amount_cents ?? 0;
  await supabase
    .from('payouts')
    .update({
      reversed_amount_cents: Math.max(0, held - Math.max(0, reversedCents)),
      status: previousStatus,
    })
    .eq('id', payoutId);
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
    .select('amount_cents')
    .eq('photographer_id', photographerId)
    .in('status', ['pending', 'approved', 'processing']);

  if (error) {
    throw new Error(`Failed to get pending payouts: ${getErrorMessage(error)}`);
  }

  return (data ?? []).reduce((sum, payout) => sum + payout.amount_cents, 0);
}
