/**
 * Payouts-related database queries
 * For tracking photographer payout requests and processing
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

/**
 * `processing` (T-216) is the state between "this row owns the money" and "the
 * transfer is confirmed". A row sits here while a Stripe call is in flight, and
 * the retry worker re-drives it with the SAME idempotency key — which is why a
 * claim is never reverted once a Stripe call has been issued against it.
 */
export type PayoutStatus = 'pending' | 'approved' | 'processing' | 'paid' | 'cancelled';

/** Why a payout could not be sent when the sale completed (T-216). */
export type PayoutHoldReason = 'connect_inactive' | 'below_minimum' | 'transfer_failed';

/** Which table `order_id` points at — `orders` and `guest_orders` are separate. */
export type PayoutOrderKind = 'order' | 'guest_order';

export interface Payout {
  id: string;
  photographer_id: string;
  amount_cents: number;
  status: PayoutStatus;
  admin_notes: string | null;
  stripe_transfer_id: string | null;
  stripe_charge_id: string | null;
  currency: string | null;
  hold_reason: PayoutHoldReason | null;
  order_id: string | null;
  order_kind: PayoutOrderKind | null;
  transfer_batch_id: string | null;
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

/**
 * Void outstanding holds for a refunded charge (T-216).
 *
 * Without this, T-216 would CREATE a loss the pre-ledger code does not have: a
 * stranded hold is accidentally protected by being stranded, but once a worker
 * pays holds it would happily send a refunded buyer's money to the photographer.
 *
 * Only `pending` rows are voided. A `processing` row may already have a transfer
 * in flight at Stripe, and reversing that is a different operation (T-215) —
 * silently marking it cancelled here would desync the ledger from Stripe.
 *
 * ⚠️ **A PARTIAL refund voids the whole hold**, under-paying the photographer.
 * `charge.refunded` fires for partial refunds too, and this is deliberately
 * consistent with the pre-existing handler, which already flips the whole order
 * to `refunded` (revoking all buyer access) on a partial refund. Proportional
 * handling is explicitly T-215's scope; erring toward not sending money is the
 * recoverable direction, since a hold can be re-created but a transfer cannot be
 * un-sent.
 */
export async function voidHoldsForCharge(
  supabase: SupabaseServerClient,
  stripeChargeId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('payouts')
    .update({
      status: 'cancelled',
      admin_notes: 'T-216: voided — the originating charge was refunded.',
    })
    .eq('stripe_charge_id', stripeChargeId)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    throw new Error(`Failed to void holds for charge: ${getErrorMessage(error)}`);
  }

  return (data ?? []).length;
}

/**
 * Calculate total paid out amount for a photographer
 */
export async function getTotalPaidOut(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('payouts')
    .select('amount_cents')
    .eq('photographer_id', photographerId)
    .eq('status', 'paid');

  if (error) {
    throw new Error(`Failed to get total paid out: ${getErrorMessage(error)}`);
  }

  return (data ?? []).reduce((sum, payout) => sum + payout.amount_cents, 0);
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

/**
 * How many `connect_inactive` holds this photographer currently has outstanding
 * (T-250).
 *
 * Backs the anti-spam rule for the "you sold something but can't be paid yet"
 * email: it is sent only when the row that was just opened is the **only** one
 * outstanding — i.e. this sale *starts* a holding streak. A photographer who
 * sells 40 photos while disconnected gets one email, not 40.
 *
 * The rule needs no new column and no new table because the ledger already
 * carries the state, and it **self-resets**: once `retry-pending-payouts` drains
 * the streak (the rows flip to `paid`), a later hold starts a new streak and is
 * worth telling them about again.
 *
 * Deliberately narrower than `getTotalPendingPayouts`, which counts every
 * unlanded status: this asks "are they already in the state this email
 * announces?", and a `below_minimum` or `transfer_failed` hold is a different
 * state with a different remedy.
 */
export async function countOutstandingConnectInactiveHolds(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('payouts')
    .select('id', { count: 'exact', head: true })
    .eq('photographer_id', photographerId)
    .eq('status', 'pending')
    .eq('hold_reason', 'connect_inactive');

  if (error) {
    throw new Error(
      `Failed to count outstanding connect_inactive holds: ${getErrorMessage(error)}`,
    );
  }

  return count ?? 0;
}
