/**
 * Stripe Webhook Handler
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events:
 * - checkout.session.completed: Create order/order_items (payment) or update subscription (subscription)
 * - payment_intent.succeeded: Update order status
 * - payment_intent.payment_failed: Update order status
 * - customer.subscription.created: Create/update subscription
 * - customer.subscription.updated: Update subscription
 * - customer.subscription.deleted: Cancel subscription
 */

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { clearCart } from '@/database/queries/carts';
import { createDownloadToken } from '@/database/queries/download-tokens';
import {
  addGuestOrderItems,
  createGuestOrder,
  getGuestOrderBySessionId,
} from '@/database/queries/guest-orders';
import {
  addOrderItems,
  createOrder,
  getOrderByCheckoutSessionId,
  getOrderByPaymentIntentId,
  updateOrderStatus,
} from '@/database/queries/orders';
import { supabaseAdmin } from '@/database/supabase-admin';
import { env } from '@/env.mjs';
import { sendGuestPurchaseEmail } from '@/lib/email/send-guest-purchase-email';
import { stripe } from '@/lib/stripe/config';
import { STRIPE_PRICE_TO_PLAN } from '@/lib/stripe/plans-stripe';

export async function POST(request: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // Handle subscription checkout
        if (session.mode === 'subscription') {
          const userId = session.metadata?.supabase_user_id ?? session.metadata?.user_id;
          const customerId = typeof session.customer === 'string' ? session.customer : null;

          if (!userId && customerId) {
            // Try to find user by customer_id in subscriptions table
            const { data: existingSub } = await supabaseAdmin
              .from('subscriptions')
              .select('user_id')
              .eq('stripe_customer_id', customerId)
              .limit(1)
              .maybeSingle();

            if (existingSub?.user_id) {
              console.log(
                `Found user ${existingSub.user_id} for subscription checkout via customer_id lookup`,
              );
              // Subscription will be updated via customer.subscription.created webhook
              break;
            }
          }

          if (!userId) {
            console.warn(
              `Subscription checkout completed but missing user_id in metadata for session ${session.id}`,
            );
            break;
          }

          // Subscription will be created/updated via customer.subscription.created webhook
          // This event just confirms the checkout completed
          console.log(`Subscription checkout completed for user ${userId}, session ${session.id}`);
          break;
        }

        // Handle guest checkout (no auth.users dependency)
        if (session.metadata?.is_guest === 'true') {
          const existingGuestOrder = await getGuestOrderBySessionId(supabaseAdmin, session.id);

          if (existingGuestOrder) {
            console.log(`Guest order already exists for session ${session.id}`);
            break;
          }

          const guestEmail =
            session.customer_details?.email ??
            (typeof session.customer_email === 'string' ? session.customer_email : null);

          if (!guestEmail) {
            console.error('No email in guest checkout session');
            break;
          }

          // Decode cart items from Stripe metadata (no DB lookup needed)
          const cartCount = Number.parseInt(session.metadata?.cart_count ?? '0', 10);
          const cartItems: Array<{
            photoId: string;
            photographerId: string;
            unitPriceCents: number;
          }> = [];
          for (let i = 0; i < cartCount; i++) {
            const raw = session.metadata?.[`cart_${i}`];
            if (raw) {
              const { p, g, c } = JSON.parse(raw);
              cartItems.push({
                photoId: p,
                photographerId: g,
                unitPriceCents: c,
              });
            }
          }
          if (cartItems.length === 0) {
            console.error('No cart items found in guest session metadata');
            break;
          }

          const totalAmountCents = cartItems.reduce((sum, item) => sum + item.unitPriceCents, 0);

          const guestOrder = await createGuestOrder(supabaseAdmin, {
            guest_email: guestEmail,
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id:
              typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
            stripe_customer_id: typeof session.customer === 'string' ? session.customer : undefined,
            total_amount_cents: totalAmountCents,
            currency: session.currency ?? 'usd',
            metadata: { stripe_session_id: session.id },
          });

          await addGuestOrderItems(
            supabaseAdmin,
            guestOrder.id,
            cartItems.map((item) => ({
              photo_id: item.photoId,
              photographer_id: item.photographerId,
              unit_price_cents: item.unitPriceCents,
              quantity: 1,
            })),
          );

          const downloadToken = await createDownloadToken(supabaseAdmin, {
            guestOrderId: guestOrder.id,
          });

          // Determine base URL for links in email
          const baseUrl = env.SITE_URL;

          // Get event names for the email from DB
          const photoIds = cartItems.map((i) => i.photoId);
          const { data: photoRows } = await supabaseAdmin
            .from('photos')
            .select('events(name)')
            .in('id', photoIds);
          const eventNames = [
            ...new Set(
              (photoRows ?? [])
                .map((r) => {
                  const ev = Array.isArray(r.events) ? r.events[0] : r.events;
                  return ev?.name ?? null;
                })
                .filter((n): n is string => n !== null),
            ),
          ];

          // Send download link email
          try {
            await sendGuestPurchaseEmail({
              to: guestEmail,
              downloadToken: downloadToken.token,
              photoCount: cartItems.length,
              eventNames,
              baseUrl,
            });
          } catch (emailErr) {
            console.error('Failed to send guest purchase email:', emailErr);
            // Don't fail the webhook — order already created
          }

          console.log(`Guest order created: ${guestOrder.id} for ${guestEmail}`);
          break;
        }

        // Handle payment checkout (cart-based orders)
        // Check if order already exists
        const existingOrder = await getOrderByCheckoutSessionId(supabaseAdmin, session.id);

        if (existingOrder) {
          console.log(`Order already exists for session ${session.id}`);
          break;
        }

        // Get user_id from metadata
        const userId = session.metadata?.user_id;
        const cartId = session.client_reference_id ?? session.metadata?.cart_id;

        if (!userId) {
          console.error('Missing user_id in session metadata');
          break;
        }

        // Get cart items
        if (!cartId) {
          console.error('Missing cart_id in session');
          break;
        }

        // Use admin client to bypass RLS for webhook operations
        // First verify cart belongs to user
        const { data: cart } = await supabaseAdmin
          .from('carts')
          .select('*')
          .eq('id', cartId)
          .eq('user_id', userId)
          .maybeSingle();

        if (!cart) {
          console.error(`Cart ${cartId} not found or doesn't belong to user ${userId}`);
          break;
        }

        // Get cart items with admin client
        const { data: cartItemsData, error: cartItemsError } = await supabaseAdmin
          .from('cart_items')
          .select(
            `
            id,
            cart_id,
            photo_id,
            photographer_id,
            unit_price_cents,
            created_at,
            photos!inner(
              original_url,
              events(
                name,
                date
              )
            )
          `,
          )
          .eq('cart_id', cartId);

        if (cartItemsError || !cartItemsData || cartItemsData.length === 0) {
          console.error('Cart is empty or error fetching cart items:', cartItemsError);
          break;
        }

        // Map cart items to CartItemWithDetails format
        const cartItems = (cartItemsData ?? []).map(
          (item: {
            id: string;
            cart_id: string;
            photo_id: string;
            photographer_id: string;
            unit_price_cents: number;
            created_at: string;
            photos:
              | Array<{
                  original_url: string | null;
                  events:
                    | Array<{ name: string | null; date: string | null }>
                    | { name: string | null; date: string | null }
                    | null;
                }>
              | {
                  original_url: string | null;
                  events:
                    | Array<{ name: string | null; date: string | null }>
                    | { name: string | null; date: string | null }
                    | null;
                }
              | null;
          }) => {
            const photo = Array.isArray(item.photos) ? item.photos[0] : item.photos;
            const event = photo
              ? Array.isArray(photo.events)
                ? photo.events[0]
                : photo.events
              : null;
            return {
              id: item.id,
              cart_id: item.cart_id,
              photo_id: item.photo_id,
              photographer_id: item.photographer_id,
              unit_price_cents: item.unit_price_cents,
              created_at: item.created_at,
              photo_url: photo?.original_url ?? null,
              photographer_name: null, // Not needed for order creation
              event_name: event?.name ?? null,
              event_date: event?.date ?? null,
            };
          },
        );

        // Calculate total
        const totalAmountCents = cartItems.reduce((sum, item) => sum + item.unit_price_cents, 0);

        // Create order using admin client
        const order = await createOrder(supabaseAdmin, userId, {
          cart_id: cartId,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id:
            typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
          stripe_customer_id: typeof session.customer === 'string' ? session.customer : undefined,
          status: 'completed',
          total_amount_cents: totalAmountCents,
          metadata: {
            stripe_session_id: session.id,
            amount_total: session.amount_total,
            currency: session.currency,
          },
        });

        // Add order items using admin client
        await addOrderItems(
          supabaseAdmin,
          order.id,
          cartItems.map((item) => ({
            photo_id: item.photo_id,
            photographer_id: item.photographer_id,
            unit_price_cents: item.unit_price_cents,
            quantity: 1,
          })),
        );

        // Clear cart after successful order using admin client
        await clearCart(supabaseAdmin, cartId);

        // Invalidate Next.js RSC cache for affected pages
        revalidatePath('/[lang]/dashboard/talent/cart', 'page');
        revalidatePath('/[lang]/dashboard/talent/orders', 'page');
        revalidatePath('/[lang]/dashboard/talent/profile', 'page');

        console.log(`Order created: ${order.id} for user ${userId}`);
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        const order = await getOrderByPaymentIntentId(supabaseAdmin, paymentIntent.id);

        if (order && order.status !== 'completed') {
          await updateOrderStatus(supabaseAdmin, order.id, 'completed', {
            payment_intent_succeeded_at: new Date().toISOString(),
          });
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        const order = await getOrderByPaymentIntentId(supabaseAdmin, paymentIntent.id);

        if (order && order.status === 'pending') {
          await updateOrderStatus(supabaseAdmin, order.id, 'failed', {
            payment_intent_failed_at: new Date().toISOString(),
            failure_reason: paymentIntent.last_payment_error?.message,
          });
        }
        break;
      }

      // --- SUBSCRIPTION EVENTS -----------------------------------------
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const status = subscription.status;

        // Retrieve customer metadata (contains supabase_user_id)
        const customer = await stripe.customers.retrieve(customerId);
        // biome-ignore lint/suspicious/noExplicitAny: customer metadata
        let supabaseUserId = (customer as any).metadata?.supabase_user_id;

        // If metadata is missing (e.g., in test scenarios), try to find user by customer_id
        if (!supabaseUserId) {
          const { data: existingSub } = await supabaseAdmin
            .from('subscriptions')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .limit(1)
            .maybeSingle();

          if (existingSub?.user_id) {
            supabaseUserId = existingSub.user_id;
            console.log(`Found user ${supabaseUserId} for subscription via customer_id lookup`);
          }
        }

        if (!supabaseUserId) {
          console.warn(
            `Missing supabase_user_id in customer metadata for subscription ${subscription.id}. This may be a test event.`,
          );
          break;
        }

        // Determine plan_id from price
        const priceId = subscription.items.data[0]?.price?.id ?? null;
        const planId = priceId ? STRIPE_PRICE_TO_PLAN[priceId] : 'free';

        // biome-ignore lint/suspicious/noExplicitAny: subscription object
        const sub = subscription as any;

        const currentPeriodEnd =
          typeof sub.current_period_end === 'number'
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;

        // Check if subscription already exists
        const { data: existingSubscription } = await supabaseAdmin
          .from('subscriptions')
          .select('id')
          .eq('user_id', supabaseUserId)
          .maybeSingle();

        const subscriptionData = {
          user_id: supabaseUserId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          plan_id: planId,
          status,
          current_period_end: currentPeriodEnd,
          updated_at: new Date().toISOString(),
        };

        let error: { message: string; code?: string } | null = null;
        if (existingSubscription) {
          // Update existing subscription
          const { error: updateError } = await supabaseAdmin
            .from('subscriptions')
            .update(subscriptionData)
            .eq('user_id', supabaseUserId);
          error = updateError;
        } else {
          // Insert new subscription
          const { error: insertError } = await supabaseAdmin
            .from('subscriptions')
            .insert(subscriptionData);
          error = insertError;
        }

        if (error) {
          console.error('Error upserting subscription:', error);
        } else {
          console.log(
            `Subscription ${existingSubscription ? 'updated' : 'created'} for user ${supabaseUserId} → ${planId} (${status})`,
          );
        }

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const customer = await stripe.customers.retrieve(customerId);
        // biome-ignore lint/suspicious/noExplicitAny: customer metadata
        let supabaseUserId = (customer as any).metadata?.supabase_user_id;

        // If metadata is missing, try to find user by customer_id
        if (!supabaseUserId) {
          const { data: existingSub } = await supabaseAdmin
            .from('subscriptions')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .limit(1)
            .maybeSingle();

          if (existingSub?.user_id) {
            supabaseUserId = existingSub.user_id;
          }
        }

        if (!supabaseUserId) {
          console.warn(
            `Missing supabase_user_id for deleted subscription ${subscription.id}. This may be a test event.`,
          );
          break;
        }

        const { error } = await supabaseAdmin
          .from('subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', supabaseUserId)
          .eq('stripe_subscription_id', subscription.id);

        if (error) {
          console.error('Error canceling subscription:', error);
        } else {
          console.log(`Subscription canceled for user ${supabaseUserId}`);
        }

        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
