/**
 * Subscription-related database queries
 * For managing Stripe subscriptions
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

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
  created_at: string;
  updated_at: string;
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
    .in('status', ['active', 'trialing', 'past_due']);

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
