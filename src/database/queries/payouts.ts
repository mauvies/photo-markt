/**
 * Payouts-related database queries
 * For tracking photographer payout requests and processing
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'cancelled';

export interface Payout {
  id: string;
  photographer_id: string;
  amount_cents: number;
  status: PayoutStatus;
  admin_notes: string | null;
  payment_account_id: string | null;
  stripe_transfer_id: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
}

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
 * Log a Stripe transfer as a paid payout. Idempotent — ignores conflicts on stripe_transfer_id.
 */
export async function createPayoutFromTransfer(
  supabase: SupabaseServerClient,
  params: {
    photographer_id: string;
    amount_cents: number;
    stripe_transfer_id: string;
  },
): Promise<void> {
  const { error } = await supabase.from('payouts').insert({
    photographer_id: params.photographer_id,
    amount_cents: params.amount_cents,
    stripe_transfer_id: params.stripe_transfer_id,
    status: 'paid',
    paid_at: new Date().toISOString(),
  });

  if (error && error.code !== '23505') {
    // 23505 = unique_violation (duplicate transfer_id) — safe to ignore
    throw new Error(`Failed to log payout from transfer: ${getErrorMessage(error)}`);
  }
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
 * Calculate pending payout amount for a photographer
 */
export async function getTotalPendingPayouts(
  supabase: SupabaseServerClient,
  photographerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('payouts')
    .select('amount_cents')
    .eq('photographer_id', photographerId)
    .in('status', ['pending', 'approved']);

  if (error) {
    throw new Error(`Failed to get pending payouts: ${getErrorMessage(error)}`);
  }

  return (data ?? []).reduce((sum, payout) => sum + payout.amount_cents, 0);
}
