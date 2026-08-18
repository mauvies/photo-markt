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
 * - account.updated: Sync photographer Stripe Connect status + release held payouts on activation
 * - charge.refunded: Mark order as refunded + void outstanding payout holds for the charge
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
 * T-216 narrows the exposure but does not close it: a refund now VOIDS any payout still
 * held for that charge, so unsent money is never sent. A transfer already made still needs
 * a manual reversal (T-215 owns automating that).
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
import {
  holdPayoutRow,
  openPayoutRow,
  type PayoutHoldReason,
  type PayoutOrderKind,
  settlePayoutPaid,
  voidHoldsForCharge,
} from '@/database/queries/payouts';
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
import { sendPurchaseConfirmationEmail } from '@/lib/email/send-purchase-confirmation-email';
import { inngest } from '@/lib/inngest/client';
import { reportMoneyIncident } from '@/lib/observability/report-money-incident';
import {
  payoutIdempotencyKey,
  payoutTransferGroup,
  STRIPE_MIN_TRANSFER_CENTS,
} from '@/lib/payouts/batching';
import { getPhotographerNetCents } from '@/lib/plans';
import { stripe } from '@/lib/stripe/config';
import {
  createTransfer,
  deriveConnectStatus,
  reconcileAndPersistConnectStatus,
} from '@/lib/stripe/connect';
import { STRIPE_PRICE_TO_PLAN } from '@/lib/stripe/plans-stripe';
import { subscriptionPeriodEndISO } from '@/lib/stripe/subscription-period';
import { parseWithdrawalConsentMetadata } from '@/lib/withdrawal-consent';

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
 * Create Stripe transfers for the photographers in an order, and record a
 * durable debt for every euro that could not be sent (T-216).
 *
 * **The ledger row is opened BEFORE the Stripe call and its id IS the
 * idempotency key.** That ordering is the whole design, not a detail: it turns
 * the `(stripe_charge_id, photographer_id)` unique index into a mutual-exclusion
 * primitive that *prevents* a second payment, instead of a constraint that fires
 * on the log insert afterwards and can only record that one happened.
 *
 * The scenario it closes: a sale is held because Connect isn't active, the retry
 * worker pays it, and then Stripe redelivers `payment_intent.succeeded` — it
 * retries for up to 3 days, well past the 24-hour idempotency window, and an
 * operator can resend by hand at any time. By then the account IS active, so the
 * old code would transfer again under a key that had never been used. Now
 * `openPayoutRow` returns null, and we transfer nothing.
 *
 * Every non-sending outcome writes a `pending` row with a `hold_reason` instead
 * of a `console.warn` that nobody reads.
 */
async function createTransfersForOrderItems(
  items: Array<{ photographer_id: string; total_price_cents: number }>,
  chargeId: string,
  orderId: string,
  // The order's stored currency == the charge currency. The transfer must match
  // it (Stripe rejects a currency mismatch against `source_transaction`), so a
  // pre-T-193 USD charge's transfer stays USD instead of being forced to EUR.
  currency: string,
  // Which table `orderId` points at — `orders` and `guest_orders` are separate,
  // which is why the ledger's `order_id` carries no foreign key (T-216).
  orderKind: PayoutOrderKind,
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

  // ⚠️ The loop below walks `connectStatuses`, but the money lives in `totals`.
  // `getPhotographerConnectStatuses` returns only the `profiles` rows that
  // exist, so a photographer whose row is missing (or a short read) is money
  // that never reaches the loop at all — no payout row, no hold, no log (T-249).
  const unresolved = [...totals.keys()].filter(
    (id) => !connectStatuses.some((status) => status.id === id),
  );
  for (const photographerId of unresolved) {
    await reportMoneyIncident({
      kind: 'payout-not-recorded',
      message:
        'An order item names a photographer with no resolvable profile, so their share was ' +
        'never considered for transfer and no debt was recorded.',
      context: {
        photographerId,
        chargeId,
        orderId,
        orderKind,
        grossCents: totals.get(photographerId),
        currency,
      },
    });
  }

  for (const status of connectStatuses) {
    const grossCents = totals.get(status.id) ?? 0;
    if (grossCents === 0) continue;

    // Net is computed FIRST, before any gate (T-216). A held transfer has to
    // record the amount it would have paid, and the old order — gate, then
    // compute — made that impossible on the inactive-Connect path.
    const netCents = getPhotographerNetCents(grossCents, planIds.get(status.id));

    // A net that rounds to zero is not a debt. The ledger's `amount_cents > 0`
    // check would reject the row anyway.
    if (netCents <= 0) continue;

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

    const payable = effectiveStatus === 'active' && Boolean(status.stripe_connect_account_id);
    const holdReason: PayoutHoldReason | null = !payable
      ? 'connect_inactive'
      : netCents < STRIPE_MIN_TRANSFER_CENTS
        ? 'below_minimum'
        : null;

    // Reserve the money before touching Stripe. `null` means another writer
    // already owns this (charge, photographer) — a redelivery, or the retry
    // worker mid-flight — so we must transfer nothing.
    let payout: Awaited<ReturnType<typeof openPayoutRow>>;
    try {
      payout = await openPayoutRow(supabaseAdmin, {
        photographer_id: status.id,
        amount_cents: netCents,
        currency,
        stripe_charge_id: chargeId,
        order_id: orderId,
        order_kind: orderKind,
        hold_reason: holdReason,
      });
    } catch (err) {
      // The buyer has already paid; a ledger failure must not fail the webhook,
      // or Stripe redelivers and we retry a payment we may have made. That
      // discipline is right, but it is also what made this silent: without the
      // row there is no debt, no transfer, and nothing for the retry worker to
      // find, so the money simply leaves the system (T-249). Alerting is the
      // only thing that changes here — the `continue` and the 200 both stand.
      await reportMoneyIncident({
        kind: 'payout-not-recorded',
        message:
          'Could not open the payout ledger row. This sale skipped the transfer entirely and ' +
          'left no debt for the retry worker to drain — reconcile by hand.',
        context: {
          photographerId: status.id,
          chargeId,
          orderId,
          orderKind,
          netCents,
          currency,
        },
        cause: err,
      });
      continue;
    }

    if (!payout) {
      console.log(
        `[payouts] charge ${chargeId} / photographer ${status.id} already has a payout row — skipping.`,
      );
      continue;
    }

    if (holdReason) {
      console.warn(
        `[payouts] held ${netCents} cents for photographer ${status.id} (${holdReason}); payout ${payout.id} awaits retry.`,
      );
      continue;
    }

    // `status.stripe_connect_account_id` is non-null here — `payable` proved it,
    // but TypeScript can't carry that through the boolean.
    const destination = status.stripe_connect_account_id as string;

    try {
      const transfer = await createTransfer({
        amountCents: netCents,
        currency,
        destination,
        sourceTransaction: chargeId,
        // ⚠️ Must match what the retry worker sends for this same row, byte for
        // byte. Stripe compares the WHOLE request body against the one stored
        // under an idempotency key and 400s on any divergence, so a shared key
        // with a different `transfer_group` dedupes nothing — it just wedges the
        // retry. Hence a payout-derived group here, not `orderId`.
        transferGroup: payoutTransferGroup(payout.id),
        idempotencyKey: payoutIdempotencyKey(payout.id),
      });

      await settlePayoutPaid(supabaseAdmin, payout.id, transfer.id);

      console.log(`Transfer ${transfer.id} created: ${netCents} cents → photographer ${status.id}`);
    } catch (err) {
      console.error(`Failed to create transfer for photographer ${status.id}:`, err);
      // Park the reserved row instead of creating a second one. The retry worker
      // re-drives it under the SAME idempotency key and the SAME parameters, so
      // a transfer Stripe did make despite the thrown error is returned rather
      // than duplicated — and once the key expires, the worker's probe catches
      // it instead.
      await holdPayoutRow(supabaseAdmin, payout.id, 'transfer_failed').catch(async (holdErr) => {
        // Worse than it looks, and the reason this is an alert rather than a log
        // (T-249): the row stays `processing` with no `transfer_batch_id`, and
        // NEITHER recovery path picks that up — `listPayableHolds` requires
        // `pending` + a `hold_reason`, `listStaleProcessingBatches` requires a
        // batch id. The debt is real, recorded, and permanently invisible.
        await reportMoneyIncident({
          kind: 'payout-not-recorded',
          message:
            'Transfer failed AND the payout row could not be parked as a hold. It is stranded ' +
            'in `processing` with no batch id, so no retry path will ever pick it up.',
          context: {
            photographerId: status.id,
            payoutId: payout?.id,
            chargeId,
            orderId,
            orderKind,
            netCents,
            currency,
          },
          cause: holdErr,
        });
      });
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

          // T-228: the art. 16(m) consent stamped when the session was created.
          // Fails OPEN — a session created before the gate shipped carries no
          // consent, and the buyer has already paid, so the order is still
          // created with NULL columns. Refusing delivery over a missing record
          // would punish the buyer for our deploy timing.
          const guestWithdrawalConsent = parseWithdrawalConsentMetadata(session.metadata);

          const guestOrder = await createGuestOrder(supabaseAdmin, {
            guest_email: guestEmail,
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id:
              typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
            stripe_customer_id: typeof session.customer === 'string' ? session.customer : undefined,
            total_amount_cents: totalAmountCents,
            currency: session.currency ?? PLATFORM_CURRENCY,
            metadata: { stripe_session_id: session.id },
            withdrawal_consent: guestWithdrawalConsent,
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
              // Art. 8.7: the confirmation on a durable medium has to restate
              // the consent that removed the right of withdrawal.
              withdrawalConsent: guestWithdrawalConsent,
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
                  'guest_order',
                );
              } else {
                await reportMoneyIncident({
                  kind: 'payout-not-recorded',
                  message:
                    'No charge id on the guest order payment intent, so no transfer could be ' +
                    'attempted. The guest order exists and the photographer is owed money.',
                  context: { paymentIntentId: piId, orderId: guestOrder.id },
                });
              }
            } catch (transferErr) {
              // A guest sale loses money exactly the same way an authenticated
              // one does, so it has to be as loud (T-249). This catch is wider
              // than the authenticated path's — it also covers the PaymentIntent
              // retrieve, the Connect/plan lookups and the status reconcile —
              // which is precisely why a bare log here could hide more, not less.
              //
              // ⚠️ It must NOT claim nothing was paid. `createTransfersForOrderItems`
              // can throw part-way through a multi-photographer cart, after
              // earlier photographers were transferred AND settled. An alert
              // asserting "nothing was paid" would invite an operator to pay
              // them a second time — the one outcome this whole ledger exists to
              // prevent. Say what is certain (it threw) and name the ledger as
              // the authority on what actually moved.
              await reportMoneyIncident({
                kind: 'payout-not-recorded',
                message:
                  'The guest order transfer path threw. Some photographers on this order may ' +
                  'already have been paid and settled before it failed — check the `payouts` ' +
                  'rows for this charge before reconciling anything by hand.',
                context: { paymentIntentId: piId, orderId: guestOrder.id },
                cause: transferErr,
              });
            }
          } else {
            await reportMoneyIncident({
              kind: 'payout-not-recorded',
              message:
                'Guest checkout session carried no payment intent, so no transfer path ran at ' +
                'all for a recorded guest order.',
              context: { sessionId: session.id, orderId: guestOrder.id },
            });
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

        // T-228 — same fail-open rule as the guest branch above: a session
        // created before the gate shipped carries no consent, and the buyer has
        // already paid, so the order is created with NULL columns.
        const withdrawalConsent = parseWithdrawalConsentMetadata(session.metadata);

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
          withdrawal_consent: withdrawalConsent,
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

        // T-228 / art. 8.7: confirmation of the contract on a durable medium,
        // restating the consent that removed the right of withdrawal. Until
        // now only guests got an email — the signed-in buyer got nothing, so
        // the confirmation obligation was unmet for half the purchases.
        // Non-fatal, like the guest one: a Resend outage must not fail the
        // webhook and lose the order.
        const buyerEmail =
          session.customer_details?.email ??
          (typeof session.customer_email === 'string' ? session.customer_email : null);
        if (buyerEmail) {
          try {
            await sendPurchaseConfirmationEmail({
              to: buyerEmail,
              photoCount: cartItems.length,
              eventNames: [
                ...new Set(
                  cartItems
                    .map((item) => item.event_name)
                    .filter((name): name is string => name !== null),
                ),
              ],
              baseUrl: env.SITE_URL,
              withdrawalConsent,
            });
          } catch (emailErr) {
            console.error('Failed to send purchase confirmation email:', emailErr);
          }
        } else {
          console.error(`No buyer email on session ${session.id}; confirmation email skipped`);
        }

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
            // The order is already `completed` above, so bailing here bills the
            // buyer and pays nobody (T-249). There is no ledger row to fall back
            // on — we never got far enough to open one.
            await reportMoneyIncident({
              kind: 'payout-not-recorded',
              message:
                'No charge id on the payment intent, so no transfer could be attempted. The ' +
                'order is completed and the photographer is owed money with no ledger row.',
              context: { paymentIntentId: paymentIntent.id, orderId: order.id },
            });
            break;
          }

          const { data: orderItems, error: orderItemsError } = await supabaseAdmin
            .from('order_items')
            .select('photographer_id, total_price_cents')
            .eq('order_id', order.id);

          // ⚠️ Discarding this error was the quietest hole of the lot (T-249):
          // `orderItems` falls back to `[]`, `createTransfersForOrderItems`
          // returns immediately on the empty list, and the sale completes with
          // zero payout rows having logged **nothing at all**. That is the exact
          // shape of the 2026-07-28 incident, and a PostgREST failure here is
          // not hypothetical — T-239 was a schema-cache error on this very table.
          if (orderItemsError) {
            await reportMoneyIncident({
              kind: 'payout-not-recorded',
              message:
                'Could not read the order items, so no transfer was attempted for a completed ' +
                'order. Nothing was paid and no debt was recorded.',
              context: { orderId: order.id, chargeId, code: orderItemsError.code },
              cause: orderItemsError,
            });
            break;
          }

          // A read that succeeds but returns nothing is its own incident: a
          // completed order with a non-zero total and no items means somebody
          // was charged for photos nobody will be paid for. Without this the
          // empty list reaches the transfer loop, which returns immediately on
          // `items.length === 0` — as silent as the error branch above.
          if ((orderItems ?? []).length === 0) {
            await reportMoneyIncident({
              kind: 'payout-not-recorded',
              message:
                'A completed order has no order items, so no transfer was attempted and no ' +
                'photographer will be paid for it.',
              context: {
                orderId: order.id,
                chargeId,
                orderTotalCents: order.total_amount_cents,
              },
            });
            break;
          }

          await createTransfersForOrderItems(
            orderItems ?? [],
            chargeId,
            order.id,
            order.currency,
            'order',
          );
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

          // T-216: activation is exactly the moment a photographer's held
          // earnings became payable, so pay them now instead of making them wait
          // up to 30 minutes for the cron. Emitted only when a profile actually
          // resolved — an event for an account we don't know has nothing to pay.
          // The worker debounces on photographerId because Stripe emits
          // `account.updated` in bursts as capabilities flip.
          if (status === 'active') {
            try {
              await inngest.send({
                name: 'payouts.retry-requested',
                data: { photographerId: profile.id },
              });
            } catch (err) {
              // The cron is the backstop, so a failed emit costs latency, not
              // money — never the webhook.
              console.error('[payouts] failed to request payout retry:', err);
            }
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;

        // T-216: kill any outstanding hold for this charge BEFORE the retry
        // worker can pay it. Without this, adding the ledger would CREATE a loss
        // the old code did not have — a stranded transfer used to be
        // accidentally protected by being stranded, but a worker that pays holds
        // would send a refunded buyer's money to the photographer.
        //
        // Only `pending` rows are voided (see `voidHoldsForCharge`): a
        // `processing` row may already have a transfer in flight, and reversing
        // that is a different operation (T-215).
        try {
          const voided = await voidHoldsForCharge(supabaseAdmin, charge.id);
          if (voided > 0) {
            console.log(`[payouts] voided ${voided} outstanding hold(s) for refunded ${charge.id}`);
          }
        } catch (err) {
          console.error(`[payouts] failed to void holds for charge ${charge.id}:`, err);
        }

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
