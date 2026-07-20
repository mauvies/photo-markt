'use server';

import { getCurrentPlan, getSubscription } from '@/database/queries/subscriptions';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { env } from '@/env.mjs';
import type { BillingPeriod, PlanId } from '@/lib/plans';
import { stripe } from '@/lib/stripe/config';

/**
 * Domain error codes returned (never thrown as raw messages) by
 * `createBillingCheckoutAction`. Returned instead of thrown because Next
 * redacts thrown Server Action messages in production — call sites map these
 * stable codes to translated, actionable toasts.
 */
export type BillingCheckoutError = 'checkout_failed' | 'yearly_unavailable';

export type BillingCheckoutResult =
  | { url: string }
  | { updated: boolean }
  | { error: BillingCheckoutError };

/**
 * Resolve the Stripe Price ID for a (plan, period) pair. Yearly prices are
 * optional env vars — they only exist once the user has created the
 * corresponding Stripe yearly Prices and populated the env. Returns null in
 * that case so the caller can surface a distinct, translated message rather
 * than 500-ing.
 */
function priceIdFor(planId: 'starter' | 'pro', period: BillingPeriod): string | null {
  if (period === 'monthly') {
    return planId === 'starter' ? env.STRIPE_PRICE_AMATEUR : env.STRIPE_PRICE_PRO;
  }
  return planId === 'starter'
    ? (env.STRIPE_PRICE_AMATEUR_YEARLY ?? null)
    : (env.STRIPE_PRICE_PRO_YEARLY ?? null);
}

/**
 * Create checkout session for subscription upgrade/change.
 *
 * `period` defaults to 'monthly' so existing call sites that don't pass it
 * keep the prior behavior. The settings page and home page pricing toggle
 * pass the selected period explicitly.
 *
 * User-facing failures (Stripe errors, yearly-not-configured) are *returned*
 * as a `{ error }` code, not thrown, so the client can surface a controlled,
 * translated message (Next redacts thrown Server Action messages in prod).
 * The `Unauthorized`/`Invalid plan` guards below stay `throw`s — the UI never
 * lets a signed-in photographer reach them, so they signal a bug/tampering.
 */
export async function createBillingCheckoutAction(
  planId: 'starter' | 'pro',
  period: BillingPeriod = 'monthly',
): Promise<BillingCheckoutResult> {
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

  // Resolve the right Stripe Price ID. Yearly may not be configured yet — a
  // distinct, actionable error ("contact support") rather than the generic
  // checkout failure. Resolved before we touch Stripe.
  const priceId = priceIdFor(planId, period);
  if (!priceId) {
    return { error: 'yearly_unavailable' };
  }

  // Check if we already have a Stripe customer and active subscription.
  // `subscriptions` is a system-managed table: RLS is enabled with no policies
  // for the `authenticated` role, so this read (and the insert below) MUST use
  // the service-role client — the user-scoped client silently reads zero rows
  // and its insert is denied with 42501. Identity still comes from the
  // user-scoped `getUser()` above; only the subscription query is elevated.
  const subscription = await getSubscription(supabaseAdmin, user.id);

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
      // Return (don't throw) a domain error — Next redacts thrown Server Action
      // messages in prod, so returning lets the client show a controlled,
      // translated toast instead of the opaque "Server Components" message.
      return { error: 'checkout_failed' };
    }
  }

  // No active subscription - create new checkout session. Every Stripe call
  // here (customer + checkout session creation) is wrapped so an expired/invalid
  // API key, network failure, or misconfig degrades to a clean domain error
  // instead of the opaque "Server Components render" message Next shows when a
  // raw Stripe error escapes the action.
  try {
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          supabase_user_id: user.id,
        },
      });

      stripeCustomerId = customer.id;

      // Insert initial row (status will be updated via webhook). Supabase
      // returns `{ error }` instead of throwing, so check it explicitly —
      // otherwise a failed insert would be silently ignored, leaving an
      // orphaned Stripe customer with no local subscription row.
      const { error: insertError } = await supabaseAdmin.from('subscriptions').insert({
        user_id: user.id,
        stripe_customer_id: stripeCustomerId,
        plan_id: planId,
        status: 'incomplete',
      });

      if (insertError) {
        console.error('Error inserting subscription row:', insertError);
        return { error: 'checkout_failed' };
      }
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
      // Success returns to the overview in a "confirming" state — activation is
      // done exclusively by the Stripe webhook (customer.subscription.*), never
      // here. Reaching this URL must not grant a plan. Cancel returns to the
      // billing settings surface where the user can retry, with no partial state.
      success_url: `${baseUrl}/dashboard/photographer?checkout=success`,
      cancel_url: `${baseUrl}/dashboard/photographer/settings/billing?status=cancelled`,
      metadata: {
        supabase_user_id: user.id,
        plan_id: planId,
        billing_period: period,
      },
    });

    return { url: sessionStripe.url ?? '' };
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return { error: 'checkout_failed' };
  }
}

/**
 * Read the current user's plan for the post-checkout confirming banner. Polled
 * by the client after returning from Stripe to tolerate the gap between the
 * `success_url` redirect and the webhook that activates the subscription.
 *
 * Purely a read — it never writes or activates anything (activation is the
 * webhook's job). `active` means a paid plan is in effect; the banner flips to
 * its success state when this turns true. Reads via the service-role client
 * because `subscriptions` is system-managed (RLS-blocked for the user-scoped
 * client).
 */
export async function getSubscriptionStatusAction(): Promise<{ planId: PlanId; active: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Unauthorized');
  }

  const plan = await getCurrentPlan(supabaseAdmin, user.id);
  return { planId: plan.id, active: plan.id !== 'free' };
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

  // Get user's subscription — service-role read (system-managed table, see
  // createBillingCheckoutAction). The user-scoped client is RLS-blocked here.
  const subscription = await getSubscription(supabaseAdmin, user.id);

  if (!subscription?.stripe_subscription_id) {
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
