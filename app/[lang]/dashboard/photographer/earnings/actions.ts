'use server';

import {
  type EarningsSummary,
  getEarningsSummary,
  getPhotographerEarnings,
  type PhotographerEarning,
} from '@/database/queries/earnings';
import { createPayout, getPayouts, type Payout } from '@/database/queries/payouts';
import { getProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';

/**
 * Get earnings summary for current photographer
 */
export async function getEarningsSummaryAction(): Promise<EarningsSummary> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return getEarningsSummary(supabase, user.id);
}

/**
 * Get photographer earnings list
 */
export async function getPhotographerEarningsAction(
  limit = 50,
  startDate?: string,
  endDate?: string,
): Promise<PhotographerEarning[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return getPhotographerEarnings(supabase, user.id, limit, startDate, endDate);
}

/**
 * Get payouts for current photographer
 */
export async function getPayoutsAction(
  status?: 'pending' | 'approved' | 'paid' | 'cancelled',
): Promise<Payout[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  return getPayouts(supabase, user.id, status);
}

/**
 * Create a payout request
 */
export async function createPayoutRequestAction(
  amountCents: number,
  paymentAccountId: string,
): Promise<Payout> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const profile = await getProfile(supabase, user.id);
  if (!profile?.is_payout_profile_complete) {
    throw new Error('Please complete your payout profile before requesting withdrawals.');
  }
  if (amountCents <= 0) {
    throw new Error('Payout amount must be greater than 0.');
  }
  if (!paymentAccountId) {
    throw new Error('Payment account is required.');
  }

  // Check available balance
  const summary = await getEarningsSummary(supabase, user.id);
  const availableBalance = summary.withdrawableBalanceCents;

  if (amountCents > availableBalance) {
    throw new Error(
      `Insufficient balance. Available: $${(availableBalance / 100).toFixed(2)}, Requested: $${(amountCents / 100).toFixed(2)}`,
    );
  }

  return createPayout(supabase, user.id, amountCents, paymentAccountId);
}
