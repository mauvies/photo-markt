'use server';

import {
  type EarningsSummary,
  getEarningsSummary,
  getPhotographerEarnings,
  type PhotographerEarning,
} from '@/database/queries/earnings';
import { hasBundlePricingConfigured } from '@/database/queries/events';
import { getPayouts, type Payout } from '@/database/queries/payouts';
import { getProfileStripeConnect } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import { type PayoutOutlook, retrievePayoutOutlook } from '@/lib/stripe/connect';

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

/**
 * Whether this photographer has volume pricing configured anywhere — decides
 * whether the Earnings tab explains what a bundle discount is (T-205).
 */
export async function getHasBundlePricingAction(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  return hasBundlePricingConfigured(supabase, user.id);
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

/**
 * The photographer's balance AND the dates Stripe attaches to it (T-246).
 *
 * Replaces the balance-only read: two numbers with no dates left the obvious
 * question — "so when do I actually get it?" — answered nowhere in the product,
 * which is how the copy around them ended up inventing answers.
 *
 * Null when there is no active connected account, and on any Stripe failure: a
 * missing date renders as nothing, never as a guess.
 */
export async function getPayoutOutlookAction(): Promise<PayoutOutlook | null> {
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
    return await retrievePayoutOutlook(connect.stripe_connect_account_id);
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
