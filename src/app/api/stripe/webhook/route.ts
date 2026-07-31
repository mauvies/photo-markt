/**
 * Stripe Webhook Handler
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events:
 * - checkout.session.completed: Create order/order_items (payment) or update subscription (subscription)
 * - payment_intent.succeeded: Update order status + create Stripe transfers to photographers
 * - payment_intent.payment_failed: Update order status
 * - customer.subscription.created: Create/update subscription
 * - customer.subscription.updated: Update subscription
 * - customer.subscription.deleted: Cancel subscription
 * - account.updated: Sync photographer Stripe Connect status
 * - charge.refunded: Mark order as refunded
 *
 * Stripe Dashboard setup required:
 * - Enable Stripe Connect with Express accounts (Connect > Get started)
 * - Set payout schedule to Weekly, minimum $25 (Connect > Settings > Payouts)
 * - Subscribe this endpoint to ALL events this handler processes:
 *   checkout.session.completed, payment_intent.succeeded,
 *   payment_intent.payment_failed, customer.subscription.created,
 *   customer.subscription.updated, customer.subscription.deleted,
 *   account.updated, charge.refunded
 *   (T-192: an earlier version of this list named only account.updated +
 *   charge.refunded; a prod endpoint configured from it silently dropped every
 *   sale and subscription — orders/subscriptions are only ever written here.
 *   test/unit/api/stripe-webhook-setup-doc.test.ts keeps this list in sync
 *   with the switch below.)
 * - In production: https://www.photomarkt.com/api/stripe/webhook
 *   ⚠️ MUST be the www host. The apex (photomarkt.com) 307-redirects to www,
 *   and Stripe does NOT follow redirects on webhook deliveries — an endpoint
 *   registered on the apex fails EVERY delivery with a 307 (the actual T-192
 *   root cause in prod: 0 orders/subscriptions all-time while a completed
 *   livemode sale sat undelivered).
 *
 * NOTE: Transfer reversal on refund is NOT automatic. Reverse manually via Stripe Dashboard
 * for refunded orders — Stripe does not auto-reverse transfers to connected accounts.
 */

import { revalidatePath, revalidateTag } from 'next/cache';
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
import { createPayoutFromTransfer } from '@/database/queries/payouts';
import {
  getPhotographerConnectStatuses,
  getProfileByStripeConnectAccountId,
  updateProfileStripeConnect,
} from '@/database/queries/profiles';
import { getPhotographerPlanIds } from '@/database/queries/subscriptions';
import { supabaseAdmin } from '@/database/supabase-admin';
import { env } from '@/env.mjs';
import { PLATFORM_CURRENCY } from '@/lib/currency';
import { sendGuestPurchaseEmail } from '@/lib/email/send-guest-purchase-email';
import { getPhotographerNetCents } from '@/lib/plans';
import { stripe } from '@/lib/stripe/config';
import {
  createTransfer,
  deriveConnectStatus,
  reconcileAndPersistConnectStatus,
} from '@/lib/stripe/connect';
import { STRIPE_PRICE_TO_PLAN } from '@/lib/stripe/plans-stripe';
import { subscriptionPeriodEndISO } from '@/lib/stripe/subscription-period';

/**
 * Drop the cached plan read after a subscription state change (T-214).
 *
 * `getCachedDashboardData` (dashboard/photographer/actions.ts) resolves the
 * photographer's plan INSIDE a `'use cache'` tagged
 * `dashboard-photographer-<userId>` with `cacheLife('minutes')`. Without this,
 * a downgrade — including the automatic one when a cancelled period ends —
 * stays invisible until that TTL expires, so commission rates and plan limits
 * keep reporting the old plan.
 *
 * Only that tag is touched: `photographer-events-<userId>`, the other tag on
 * the same entry, carries no plan data. `revalidateTag` (not `updateTag`)
 * because this is a route handler, not a Server Action.
 */
function revalidatePhotographerPlanCache(userId: string): void {
  revalidateTag(`dashboard-photographer-${userId}`, 'max');
}

/**
 * Create Stripe transfers for all active-connect photographers in an order.
 * Called after payment succeeds to distribute photographer earnings.
 */
async function createTransfersForOrderItems(
  items: Array<{ photographer_id: string; total_price_cents: number }>,
  chargeId: string,
  orderId: string,
  // The order's stored currency == the charge currency. The transfer must match
  // it (Stripe rejects a currency mismatch against `source_transaction`), so a
  // pre-T-193 USD charge's transfer stays USD instead of being forced to EUR.
  currency: string,
): Promise<void> {
  if (items.length === 0) return;

  const photographerIds = [...new Set(items.map((i) => i.photographer_id))];

  const [connectStatuses, planIds] = await Promise.all([
    getPhotographerConnectStatuses(supabaseAdmin, photographerIds),
    getPhotographerPlanIds(supabaseAdmin, photographerIds),
  ]);

  // Group totals by photographer
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(
      item.photographer_id,
      (totals.get(item.photographer_id) ?? 0) + item.total_price_cents,
    );
  }

  for (const status of connectStatuses) {
    const grossCents = totals.get(status.id) ?? 0;
    if (grossCents === 0) continue;

    // The stored status can be stale (a lagged/missed `account.updated`
    // webhook). Before holding a transfer, reconcile a non-active cached value
    // against the live account so an actually-active photographer still gets
    // paid instead of having funds stranded in the platform account. The
    // helper only calls Stripe when the cached value is non-active (the common
    // active path skips it) and heals the stored value so the dashboard/
    // earnings views recover.
    const effectiveStatus = await reconcileAndPersistConnectStatus({
      client: supabaseAdmin,
      userId: status.id,
      accountId: status.stripe_connect_account_id,
      storedStatus: status.stripe_connect_status,
    });

    if (effectiveStatus !== 'active' || !status.stripe_connect_account_id) {
      console.warn(
        `Photographer ${status.id} has no active Connect account — transfer of ${grossCents} cents held in platform account.`,
      );
      continue;
    }

    const netCents = getPhotographerNetCents(grossCents, planIds.get(status.id));

    if (netCents < 50) {
      console.warn(
        `Skipping transfer for photographer ${status.id}: net ${netCents} cents below Stripe minimum.`,
      );
      continue;
    }

    try {
      const transfer = await createTransfer({
        amountCents: netCents,
        currency,
        destination: status.stripe_connect_account_id,
        sourceTransaction: chargeId,
        transferGroup: orderId,
        idempotencyKey: `transfer_${chargeId}_${status.id}`,
      });

      await createPayoutFromTransfer(supabaseAdmin, {
        photographer_id: status.id,
        amount_cents: netCents,
        stripe_transfer_id: transfer.id,
      });

      console.log(`Transfer ${transfer.id} created: ${netCents} cents → photographer ${status.id}`);
    } catch (err) {
      console.error(`Failed to create transfer for photographer ${status.id}:`, err);
    }
  }
}

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
              break;
            }
          }

          if (!userId) {
            console.warn(
              `Subscription checkout completed but missing user_id in metadata for session ${session.id}`,
            );
            break;
          }

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

          const cartCount = Number.parseInt(session.metadata?.cart_count ?? '0', 10);
          const cartItems: Array<{
            photoId: string;
            photographerId: string;
            unitPriceCents: number;
          }> = [];
          for (let i = 0; i < cartCount; i++) {
            const raw = session.metadata?.[`cart_${i}`];
            if (raw) {
              // `c` is the amount the checkout COMMITTED for this photo — its
              // allocated share of a bundle-discounted total (T-204), or its
              // list price when nothing was discounted. Read, never recomputed:
              // the event's ladder is editable at any moment, so re-deriving a
              // bundle price here could produce an order that disagrees with the
              // buyer's card statement.
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
            currency: session.currency ?? PLATFORM_CURRENCY,
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

          const baseUrl = env.SITE_URL;

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
          }

          // Create transfers to photographers for guest orders
          const piId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
          if (piId) {
            try {
              const pi = await stripe.paymentIntents.retrieve(piId, {
                expand: ['latest_charge'],
              });
              const chargeId =
                typeof pi.latest_charge === 'string'
                  ? pi.latest_charge
                  : ((pi.latest_charge as Stripe.Charge | null)?.id ?? null);
              if (chargeId) {
                const orderItems = cartItems.map((i) => ({
                  photographer_id: i.photographerId,
                  total_price_cents: i.unitPriceCents,
                }));
                await createTransfersForOrderItems(
                  orderItems,
                  chargeId,
                  guestOrder.id,
                  guestOrder.currency,
                );
              }
            } catch (transferErr) {
              console.error('Failed to create transfers for guest order:', transferErr);
            }
          }

          console.log(`Guest order created: ${guestOrder.id} for ${guestEmail}`);
          break;
        }

        // Handle authenticated payment checkout (cart-based orders)
        const existingOrder = await getOrderByCheckoutSessionId(supabaseAdmin, session.id);

        if (existingOrder) {
          console.log(`Order already exists for session ${session.id}`);
          break;
        }

        const userId = session.metadata?.user_id;
        const cartId = session.client_reference_id ?? session.metadata?.cart_id;

        if (!userId) {
          console.error('Missing user_id in session metadata');
          break;
        }

        if (!cartId) {
          console.error('Missing cart_id in session');
          break;
        }

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

        const { data: cartItemsData, error: cartItemsError } = await supabaseAdmin
          .from('cart_items')
          .select(
            `
            id,
            cart_id,
            photo_id,
            photographer_id,
            unit_price_cents,
            allocated_price_cents,
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

        const cartItems = (cartItemsData ?? []).map(
          (item: {
            id: string;
            cart_id: string;
            photo_id: string;
            photographer_id: string;
            unit_price_cents: number;
            allocated_price_cents: number | null;
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
              // T-204: prefer the allocation the checkout COMMITTED before the
              // session was created — this photo's share of a bundle-discounted
              // total. Absent (null) means no bundle applied, or a session
              // created before this deploy, and the list price is exactly right.
              // Never recomputed from the event's tiers: they are editable at
              // any moment, and a recompute between charge and delivery would
              // build an order that disagrees with the buyer's card statement.
              unit_price_cents: item.allocated_price_cents ?? item.unit_price_cents,
              created_at: item.created_at,
              photo_url: photo?.original_url ?? null,
              photographer_name: null,
              event_name: event?.name ?? null,
              event_date: event?.date ?? null,
            };
          },
        );

        const totalAmountCents = cartItems.reduce((sum, item) => sum + item.unit_price_cents, 0);

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

        await clearCart(supabaseAdmin, cartId);

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

        // Create Stripe transfers to photographers for authenticated orders
        if (order) {
          const chargeId =
            typeof paymentIntent.latest_charge === 'string'
              ? paymentIntent.latest_charge
              : ((paymentIntent.latest_charge as Stripe.Charge | null)?.id ?? null);

          if (!chargeId) {
            console.error(
              `No charge ID on payment_intent ${paymentIntent.id} — cannot create transfers`,
            );
            break;
          }

          const { data: orderItems } = await supabaseAdmin
            .from('order_items')
            .select('photographer_id, total_price_cents')
            .eq('order_id', order.id);

          await createTransfersForOrderItems(orderItems ?? [], chargeId, order.id, order.currency);
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

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        const status = deriveConnectStatus(account);
        const profile = await getProfileByStripeConnectAccountId(supabaseAdmin, account.id);
        if (profile) {
          await updateProfileStripeConnect(supabaseAdmin, profile.id, {
            stripe_connect_status: status,
          });
          console.log(`Connect status updated for account ${account.id}: ${status}`);
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
        if (piId) {
          const order = await getOrderByPaymentIntentId(supabaseAdmin, piId);
          if (order && order.status !== 'refunded') {
            await updateOrderStatus(supabaseAdmin, order.id, 'refunded', {
              refunded_at: new Date().toISOString(),
            });
            console.log(`Order ${order.id} marked as refunded`);
          }
        }
        // NOTE: Transfer reversal is NOT automatic — reverse manually via Stripe Dashboard
        break;
      }

      // --- SUBSCRIPTION EVENTS -----------------------------------------
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const status = subscription.status;

        const customer = await stripe.customers.retrieve(customerId);
        // biome-ignore lint/suspicious/noExplicitAny: customer metadata
        let supabaseUserId = (customer as any).metadata?.supabase_user_id;

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

        const priceId = subscription.items.data[0]?.price?.id ?? null;
        const planId = priceId ? STRIPE_PRICE_TO_PLAN[priceId] : 'free';

        // Reads `items.data[0].current_period_end` — the root field is gone in
        // our pinned API version (T-159). Shared with the cancel/reactivate
        // actions so the rule lives in exactly one place.
        const currentPeriodEnd = subscriptionPeriodEndISO(subscription);

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
          // The webhook is the ONLY writer of this flag — Stripe is the source
          // of truth and this row follows. The cancel/reactivate Server Actions
          // deliberately write nothing, so a Stripe call that succeeded without
          // its webhook can never leave the DB asserting a state Stripe lacks
          // (T-214).
          cancel_at_period_end: subscription.cancel_at_period_end ?? false,
          updated_at: new Date().toISOString(),
        };

        let error: { message: string; code?: string } | null = null;
        if (existingSubscription) {
          const { error: updateError } = await supabaseAdmin
            .from('subscriptions')
            .update(subscriptionData)
            .eq('user_id', supabaseUserId);
          error = updateError;
        } else {
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
          revalidatePhotographerPlanCache(supabaseUserId);
        }

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const customer = await stripe.customers.retrieve(customerId);
        // biome-ignore lint/suspicious/noExplicitAny: customer metadata
        let supabaseUserId = (customer as any).metadata?.supabase_user_id;

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
            // The subscription is over, so there is no longer a cancellation
            // *pending*. Leaving the flag set would make a finished row read as
            // an unfulfilled pending cancellation and offer a "reactivate" that
            // Stripe can no longer honour (T-214).
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', supabaseUserId)
          .eq('stripe_subscription_id', subscription.id);

        if (error) {
          console.error('Error canceling subscription:', error);
        } else {
          console.log(`Subscription canceled for user ${supabaseUserId}`);
          revalidatePhotographerPlanCache(supabaseUserId);
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
