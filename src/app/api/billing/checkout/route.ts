import { NextResponse } from 'next/server';
import { createClient } from '@/database/server';
import { env } from '@/env.mjs';
import { stripe } from '@/lib/stripe/config';

const PLAN_TO_PRICE: Record<string, string> = {
  starter: env.STRIPE_PRICE_AMATEUR,
  pro: env.STRIPE_PRICE_PRO,
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const planId = body?.planId as 'starter' | 'pro' | undefined;

  if (!planId || !PLAN_TO_PRICE[planId]) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  const supabase = await createClient();

  // Get current user from Supabase Auth
  // Use getUser() instead of getSession() to avoid refresh token race conditions
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if we already have a Stripe customer and active subscription
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id, status, plan_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  let stripeCustomerId = existingSub?.stripe_customer_id;

  // If user has an active subscription, update it instead of creating new checkout
  if (
    existingSub?.stripe_subscription_id &&
    existingSub.status &&
    ['active', 'trialing', 'past_due'].includes(existingSub.status)
  ) {
    // User already has an active subscription - update it
    try {
      const subscription = await stripe.subscriptions.retrieve(existingSub.stripe_subscription_id);

      // Update subscription to new plan
      await stripe.subscriptions.update(existingSub.stripe_subscription_id, {
        items: [
          {
            id: subscription.items.data[0]?.id,
            price: PLAN_TO_PRICE[planId],
          },
        ],
        proration_behavior: 'always_invoice',
        metadata: {
          supabase_user_id: user.id,
          plan_id: planId,
        },
      });

      // Subscription will be updated via customer.subscription.updated webhook
      return NextResponse.json({
        updated: true,
        message: 'Subscription updated successfully',
      });
    } catch (error) {
      console.error('Error updating subscription:', error);
      return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 });
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

  const priceId = PLAN_TO_PRICE[planId];
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
    },
  });

  return NextResponse.json({ url: sessionStripe.url });
}
