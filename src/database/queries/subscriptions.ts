/**
 * Subscription-related database queries
 * For managing Stripe subscriptions
 */

import { getPlanById, type Plan, type PlanId } from '@/lib/plans';
import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const;

export interface Subscription {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  plan_id: 'free' | 'starter' | 'pro';
  status:
    | 'incomplete'
    | 'incomplete_expired'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused';
  current_period_end: string | null;
  /**
   * Mirrors Stripe's `cancel_at_period_end`. Written only by the webhook — see
   * {@link hasPendingCancellation} for the read-side rule (T-214).
   */
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Is this subscription cancelled but still running out its paid period?
 *
 * "Pending" needs BOTH halves: the flag set AND a status that is still
 * active-equivalent. A row that already reached `canceled` is finished, not
 * pending — offering to "reactivate" it would promise something Stripe can no
 * longer do. Single exported predicate so the billing page and any future
 * reader can't drift into two definitions (T-214).
 */
export function hasPendingCancellation(sub: Subscription | null | undefined): boolean {
  if (!sub?.cancel_at_period_end) return false;
  return (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(sub.status);
}

/**
 * Get subscription for a user
 */
export async function getSubscription(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get subscription: ${getErrorMessage(error)}`);
  }

  return data as Subscription | null;
}

/**
 * Resolve the user's current plan. Falls back to the Free plan when there's
 * no userId or no subscription in an active-equivalent status. Single source
 * of truth so callers don't repeat the fallback ladder.
 */
export async function getCurrentPlan(
  supabase: SupabaseServerClient,
  userId: string | null | undefined,
): Promise<Plan> {
  const free = getPlanById('free');
  if (!free) throw new Error('Free plan missing from PLANS configuration');
  if (!userId) return free;

  const sub = await getSubscription(supabase, userId);
  const isActive =
    !!sub?.status && (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(sub.status);
  if (!isActive) return free;

  return getPlanById(sub.plan_id as PlanId) ?? free;
}

/**
 * Get plan IDs for multiple photographers — returns a Map from userId to planId.
 * Photographers without an active subscription default to 'free'.
 */
export async function getPhotographerPlanIds(
  supabase: SupabaseServerClient,
  photographerIds: string[],
): Promise<Map<string, string>> {
  if (photographerIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('subscriptions')
    .select('user_id, plan_id, status')
    .in('user_id', photographerIds)
    .in('status', ACTIVE_SUBSCRIPTION_STATUSES as unknown as string[]);

  if (error) {
    throw new Error(`Failed to get photographer plan IDs: ${getErrorMessage(error)}`);
  }

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.user_id, row.plan_id);
  }
  return map;
}

/**
 * Get subscription by Stripe subscription ID
 */
export async function getSubscriptionByStripeId(
  supabase: SupabaseServerClient,
  stripeSubscriptionId: string,
): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get subscription by Stripe ID: ${getErrorMessage(error)}`);
  }

  return data as Subscription | null;
}
