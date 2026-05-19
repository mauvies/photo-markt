import { env } from '@/env.mjs';
import type { PlanId } from '../plans';

/**
 * Reverse-lookup from Stripe Price ID to our internal `PlanId`. Used by the
 * Stripe webhook to resolve `subscription.items[0].price.id` back to a plan
 * when persisting `subscriptions.plan_id`.
 *
 * Includes both monthly and yearly Price IDs for each tier — without the
 * yearly entries, a user upgrading to yearly would have their `plan_id`
 * fall through to `undefined` and `getCurrentPlan` would treat them as
 * Free, silently breaking plan-tier enforcement (event/storage caps,
 * sales fee).
 *
 * Empty-string env values are filtered out defensively so environments
 * that haven't populated the yearly vars don't pollute the map with an
 * `""` → plan entry.
 */
function entry(priceId: string, planId: PlanId): Array<[string, PlanId]> {
  return priceId ? [[priceId, planId]] : [];
}

export const STRIPE_PRICE_TO_PLAN: Record<string, PlanId> = Object.fromEntries([
  ...entry(env.STRIPE_PRICE_AMATEUR, 'starter'),
  ...entry(env.STRIPE_PRICE_PRO, 'pro'),
  ...entry(env.STRIPE_PRICE_AMATEUR_YEARLY, 'starter'),
  ...entry(env.STRIPE_PRICE_PRO_YEARLY, 'pro'),
]);
