'use server';

import {
  type EarningsSummary,
  getEarningsSummary,
  getPhotographerEarnings,
  type PhotographerEarning,
} from '@/database/queries/earnings';
import { getPayouts, type Payout } from '@/database/queries/payouts';
import { getProfileStripeConnect } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import { retrieveConnectBalance } from '@/lib/stripe/connect';

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

export async function getStripeConnectBalanceAction(): Promise<{
  available: number;
  pending: number;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const connect = await getProfileStripeConnect(supabase, user.id);
  if (!connect?.stripe_connect_account_id || connect.stripe_connect_status !== 'active') {
    return null;
  }

  try {
    return await retrieveConnectBalance(connect.stripe_connect_account_id);
  } catch {
    return null;
  }
}

export async function getConnectStatusForEarningsAction(): Promise<{
  stripe_connect_status: 'not_connected' | 'pending' | 'active' | 'restricted';
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { stripe_connect_status: 'not_connected' };

  const connect = await getProfileStripeConnect(supabase, user.id);
  return {
    stripe_connect_status: connect?.stripe_connect_status ?? 'not_connected',
  };
}
