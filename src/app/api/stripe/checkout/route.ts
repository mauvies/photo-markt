/**
 * Create Stripe Checkout Session
 * POST /api/stripe/checkout
 */

import { NextResponse } from 'next/server';
import { getCartItemsWithDetails } from '@/database/queries/carts';
import { createClient } from '@/database/server';
import { rateLimit, retryAfterSeconds } from '@/lib/rate-limit';
import { stripe } from '@/lib/stripe/config';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Per-user rate limit on checkout creation. Each call hits the Stripe API
    // (real $$$ side effect on free-tier rate limits) and creates a session
    // that lingers in Stripe's dashboard. 20/hour generously covers honest
    // retries from network blips; abuse is bounded.
    const rl = await rateLimit({
      key: `stripe-checkout:${user.id}`,
      limit: 20,
      windowSec: 3600,
    });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too Many Requests' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds(rl)) } },
      );
    }

    // Get user's cart
    const { data: carts } = await supabase
      .from('carts')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!carts) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
    }

    // Get cart items
    const cartItems = await getCartItemsWithDetails(supabase, carts.id, user.id);

    if (cartItems.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: cartItems.map((item) => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Photo from ${item.event_name ?? 'Event'}`,
            description: item.event_date
              ? `Event date: ${new Date(item.event_date).toLocaleDateString()}`
              : undefined,
            images: item.photo_url ? [item.photo_url] : undefined,
          },
          unit_amount: item.unit_price_cents,
        },
        quantity: 1,
      })),
      mode: 'payment',
      success_url: `${request.headers.get('origin')}/dashboard/talent/cart?success=true`,
      cancel_url: `${request.headers.get('origin')}/dashboard/talent/cart?canceled=true`,
      client_reference_id: carts.id, // Store cart_id for webhook
      metadata: {
        user_id: user.id,
        cart_id: carts.id,
      },
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
