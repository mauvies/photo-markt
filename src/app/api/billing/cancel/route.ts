import { NextResponse } from 'next/server';
import { getSubscription } from '@/database/queries/subscriptions';
import { createClient } from '@/database/server';
import { stripe } from '@/lib/stripe/config';

/**
 * Cancel subscription
 * POST /api/billing/cancel
 */
export async function POST() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get user's subscription
  const subscription = await getSubscription(supabase, user.id);

  if (!subscription || !subscription.stripe_subscription_id) {
    return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
  }

  // Check if subscription is already canceled
  if (subscription.status === 'canceled') {
    return NextResponse.json({ error: 'Subscription is already canceled' }, { status: 400 });
  }

  try {
    // Cancel subscription at period end (so user keeps access until period ends)
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    return NextResponse.json({
      message: 'Subscription will be canceled at the end of the billing period',
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return NextResponse.json({ error: 'Failed to cancel subscription' }, { status: 500 });
  }
}
