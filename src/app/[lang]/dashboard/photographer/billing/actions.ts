'use server';

import { getSubscription } from '@/database/queries/subscriptions';
import { createClient } from '@/database/server';
import { env } from '@/env.mjs';
import type { BillingPeriod } from '@/lib/plans';
import { stripe } from '@/lib/stripe/config';

/**
 * Resolve the Stripe Price ID for a (plan, period) pair. Yearly prices are
 * optional env vars — they only exist once the user has created the
 * corresponding Stripe yearly Prices and populated the env. Throws a clear
 * error in that case so the UI can surface a translated message rather
 * than 500-ing.
 */
function priceIdFor(planId: 'starter' | 'pro', period: BillingPeriod): string {
  if (period === 'monthly') {
    return planId === 'starter' ? env.STRIPE_PRICE_AMATEUR : env.STRIPE_PRICE_PRO;
  }
  const yearly =
    planId === 'starter' ? env.STRIPE_PRICE_AMATEUR_YEARLY : env.STRIPE_PRICE_PRO_YEARLY;
  if (!yearly) {
    throw new Error("Yearly billing isn't available yet for this plan. Please contact support.");
  }
  return yearly;
}

/**
 * Create checkout session for subscription upgrade/change.
 *
 * `period` defaults to 'monthly' so existing call sites that don't pass it
 * keep the prior behavior. The settings page and home page pricing toggle
 * pass the selected period explicitly.
 */
export async function createBillingCheckoutAction(
  planId: 'starter' | 'pro',
  period: BillingPeriod = 'monthly',
): Promise<{ url: string } | { updated: boolean }> {
  const supabase = await createClient();

  // Get current user from Supabase Auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Unauthorized');
  }

  if (planId !== 'starter' && planId !== 'pro') {
    throw new Error('Invalid plan');
  }

  // Resolve the right Stripe Price ID — throws if yearly is requested and
  // the env var isn't populated yet. Lifted above the customer/subscription
  // checks so the error surfaces before we touch Stripe.
  const priceId = priceIdFor(planId, period);

  // Check if we already have a Stripe customer and active subscription
  const subscription = await getSubscription(supabase, user.id);

  let stripeCustomerId = subscription?.stripe_customer_id;

  // If user has an active subscription, update it instead of creating new checkout
  if (
    subscription?.stripe_subscription_id &&
    subscription.status &&
    ['active', 'trialing', 'past_due'].includes(subscription.status)
  ) {
    // User already has an active subscription - update it
    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id,
      );

      // Update subscription to new plan (and/or new period).
      await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        items: [
          {
            id: stripeSubscription.items.data[0]?.id,
            price: priceId,
          },
        ],
        proration_behavior: 'always_invoice',
        metadata: {
          supabase_user_id: user.id,
          plan_id: planId,
          billing_period: period,
        },
      });

      // Subscription will be updated via customer.subscription.updated webhook
      return {
        updated: true,
      };
    } catch (error) {
      console.error('Error updating subscription:', error);
      throw new Error('Failed to update subscription');
    }
  }

  // No active subscription - create new checkout session
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: {
        supabase_user_id: user.id,
      },
    });

    stripeCustomerId = customer.id;

    // Insert initial row (status will be updated via webhook)
    await supabase.from('subscriptions').insert({
      user_id: user.id,
      stripe_customer_id: stripeCustomerId,
      plan_id: planId,
      status: 'incomplete',
    });
  }

  const baseUrl = env.SITE_URL;

  const sessionStripe = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/dashboard/photographer/settings?status=success`,
    cancel_url: `${baseUrl}/dashboard/photographer/settings?status=cancelled`,
    metadata: {
      supabase_user_id: user.id,
      plan_id: planId,
      billing_period: period,
    },
  });

  return { url: sessionStripe.url ?? '' };
}

/**
 * Cancel subscription
 */
export async function cancelSubscriptionAction(): Promise<void> {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Unauthorized');
  }

  // Get user's subscription
  const subscription = await getSubscription(supabase, user.id);

  if (!subscription || !subscription.stripe_subscription_id) {
    throw new Error('No active subscription found');
  }

  // Check if subscription is already canceled
  if (subscription.status === 'canceled') {
    throw new Error('Subscription is already canceled');
  }

  try {
    // Cancel subscription at period end (so user keeps access until period ends)
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    throw new Error('Failed to cancel subscription');
  }
}
