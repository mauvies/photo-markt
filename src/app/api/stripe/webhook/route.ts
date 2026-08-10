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
 * - charge.refunded: Mark order (and guest order) refunded + claw back the photographer's money
 * - charge.dispute.created: Freeze outstanding payout holds; revoke buyer access for a real chargeback
 * - charge.dispute.updated: Same body — this is how an inquiry ESCALATING to a chargeback arrives
 * - charge.dispute.closed: Reverse the transfer if lost; restore access + holds if won
 *
 * Stripe Dashboard setup required:
 * - Enable Stripe Connect with Express accounts (Connect > Get started)
 * - Set payout schedule to Weekly, minimum $25 (Connect > Settings > Payouts)
 * - Subscribe this endpoint to ALL events this handler processes:
 *   checkout.session.completed, payment_intent.succeeded,
 *   payment_intent.payment_failed, customer.subscription.created,
 *   customer.subscription.updated, customer.subscription.deleted,
 *   account.updated, charge.refunded,
 *   charge.dispute.created, charge.dispute.updated, charge.dispute.closed
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
 * CLAWBACK (T-215): a reversed purchase is now unwound automatically on both sides.
 * Money not yet sent has its hold reduced proportionally (or voided on a full reversal);
 * money already sent is reversed at Stripe. Stripe still does not auto-reverse transfers
 * to connected accounts — `applyClawback` does.
 *
 * ⚠️ **Money first, then access — and only the second half may throw.** `applyClawback`
 * never throws: a 500 would make Stripe redeliver a MONEY operation, so its failures
 * surface as alerts and rows flagged for reconciliation. The access half deliberately
 * does throw, because Stripe's redelivery (up to three days) is the only retry that
 * ever revokes a refunded buyer's access when the database is briefly unavailable —
 * swallowing that error returns 200 and the buyer keeps downloading forever. The
 * ordering is what makes the redelivery safe: the money work is idempotent by
 * construction and has already completed.
 *
 * ⚠️ A partial refund reverses PROPORTIONALLY and does NOT revoke access. Stripe refunds
 * are amounts, not line items, so nothing says which photos one covered — and revoking the
 * whole order dropped the entire sale out of the photographer's `net` while only the
 * refunded fraction left `paidOut`, eating the difference from their unrelated earnings.
 *
 * ⚠️ Restoring access is gated by `mayWriteOrderStatus`: `completed` is a COMPUTED result
 * here, so writing it unguarded promotes any order that merely happens not to be
 * `completed` — one stuck `pending` on a lost `payment_intent.succeeded`, or a `failed`
 * one. Revocations always apply; only the way back is restricted to what this flow revoked.
 */

import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { clearCart } from '@/database/queries/carts';
import { createDownloadToken } from '@/database/queries/download-tokens';
import {
  addGuestOrderItems,
  createGuestOrder,
  type GuestOrder,
  getGuestOrderByPaymentIntentId,
  getGuestOrderBySessionId,
  updateGuestOrderStatus,
} from '@/database/queries/guest-orders';
import {
  addOrderItems,
  createOrder,
  getOrderByCheckoutSessionId,
  getOrderByPaymentIntentId,
  updateOrderStatus,
} from '@/database/queries/orders';
import {
  freezeHoldsForCharge,
  holdPayoutRow,
  openPayoutRow,
  type PayoutHoldReason,
  type PayoutOrderKind,
  restoreHoldsForCharge,
  settlePayoutPaid,
} from '@/database/queries/payouts';
import {
  getPhotographerConnectStatuses,
  getProfileByStripeConnectAccountId,
  updateProfileStripeConnect,
} from '@/database/queries/profiles';
import { getPhotographerPlanIds } from '@/database/queries/subscriptions';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { env } from '@/env.mjs';
import { PLATFORM_CURRENCY } from '@/lib/currency';
import { sendClawbackAlertEmail } from '@/lib/email/send-clawback-alert';
import { sendGuestPurchaseEmail } from '@/lib/email/send-guest-purchase-email';
import { sendPurchaseConfirmationEmail } from '@/lib/email/send-purchase-confirmation-email';
import { inngest } from '@/lib/inngest/client';
import { reportMoneyIncident } from '@/lib/observability/report-money-incident';
import { applyClawback } from '@/lib/payouts/apply-clawback';
import {
  payoutIdempotencyKey,
  payoutTransferGroup,
  STRIPE_MIN_TRANSFER_CENTS,
} from '@/lib/payouts/batching';
import { isChargeback, isDisputeOpen, resolveClawbackTarget } from '@/lib/payouts/clawback';
import {
  type ClawbackOrderStatus,
  isFullyRefunded,
  resolveOrderStatus,
} from '@/lib/payouts/order-status';
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

// ─── Clawback helpers (T-215) ───────────────────────────────────────────────

interface ResolvedOrders {
  order: Awaited<ReturnType<typeof getOrderByPaymentIntentId>>;
  guestOrder: GuestOrder | null;
  /** A lookup errored, so "no order" here means "unknown", not "none exists". */
  lookupFailed: boolean;
}

/**
 * Find whichever order a charge belongs to.
 *
 * ⚠️ **Both tables, always.** `orders` and `guest_orders` are entirely separate,
 * and until T-215 the refund path consulted only the first — so a refunded GUEST
 * purchase was never flipped and its download-token page kept minting fresh
 * unwatermarked URLs until the token expired. A charge matches at most one of the
 * two, so querying both costs one extra lookup and removes a whole class of
 * "we forgot the guest path" bug.
 *
 * A lookup failure is recorded on `lookupFailed` rather than thrown, so the MONEY
 * half (which is keyed on the charge, not on the order) still runs. The caller
 * re-raises it AFTER that work, so Stripe's redelivery retries the access half
 * without the clawback having been skipped.
 */
async function resolveOrdersForCharge(
  paymentIntent: string | Stripe.PaymentIntent | null | undefined,
): Promise<ResolvedOrders> {
  const piId = typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? null);
  if (!piId) return { order: null, guestOrder: null, lookupFailed: false };

  let lookupFailed = false;
  const [order, guestOrder] = await Promise.all([
    getOrderByPaymentIntentId(supabaseAdmin, piId).catch((err) => {
      console.error(`[money] order lookup failed for ${piId}:`, err);
      lookupFailed = true;
      return null;
    }),
    getGuestOrderByPaymentIntentId(supabaseAdmin, piId).catch((err) => {
      console.error(`[money] guest order lookup failed for ${piId}:`, err);
      lookupFailed = true;
      return null;
    }),
  ]);
  return { order, guestOrder, lookupFailed };
}

/**
 * Re-raise a failed order lookup once the money work is done, so the webhook 500s
 * and Stripe redelivers. Without this the access half is simply skipped and never
 * retried — the buyer keeps what they were refunded for.
 */
function assertOrdersResolved(orders: ResolvedOrders): void {
  if (orders.lookupFailed) {
    throw new Error('Order lookup failed; retrying via Stripe redelivery to revoke access.');
  }
}

/**
 * Move both order kinds to a status, skipping the ones already there.
 *
 * Access control falls out of this and nothing else: every purchased-photo read
 * gates on `status = 'completed'` (the ZIP route's `getPurchasedPhotoIdsForEvent`,
 * the talent library, the orders page's watermark choice, and the guest token
 * page), so one status write revokes or restores access everywhere at once. That
 * is why T-215 needed no changes to any read path.
 */
/**
 * May this flow write `next` over `current`?
 *
 * ⚠️ **Restoring is only ever allowed to undo a revocation this flow made.**
 * `completed` IS access, and it is a computed result here, so the reasonable-looking
 * "recompute and write" promotes any order that happens not to be `completed` —
 * including one stuck `pending` because its `payment_intent.succeeded` was lost, or
 * one that `failed`. A partial refund deliberately resolves to `completed` (it must
 * not revoke), so that path would hand the photos to someone who never paid for
 * them. Revocations always apply; only the way back is gated.
 */
function mayWriteOrderStatus(
  current: string,
  next: 'refunded' | 'disputed' | 'completed',
): boolean {
  if (next !== 'completed') return true;
  return current === 'refunded' || current === 'disputed';
}

async function moveOrdersTo(
  orders: ResolvedOrders,
  status: 'refunded' | 'disputed' | 'completed',
  metadata?: Record<string, unknown>,
): Promise<void> {
  // ⚠️ **Deliberately NOT wrapped in try/catch.** A throw here becomes a 500 and
  // Stripe redelivers for up to three days — and that retry is the ONLY thing
  // that eventually revokes a buyer's access when the database is briefly
  // unavailable. Swallowing the error would return 200, Stripe would never come
  // back, and the order would silently stay `completed`: a refunded buyer keeps
  // downloading forever, with one console line as the only trace.
  //
  // Redelivery is safe because it re-runs a money path that is idempotent by
  // construction (the reversal keys and `reversed_amount_cents` accounting), and
  // because callers do the money FIRST and the access second.
  if (orders.order && orders.order.status !== status) {
    if (mayWriteOrderStatus(orders.order.status, status)) {
      await updateOrderStatus(supabaseAdmin, orders.order.id, status, metadata);
      console.log(`[money] order ${orders.order.id} → ${status}`);
    } else {
      console.warn(
        `[money] refusing to promote order ${orders.order.id} from '${orders.order.status}' to '${status}'`,
      );
    }
  }
  if (orders.guestOrder && orders.guestOrder.status !== status) {
    if (mayWriteOrderStatus(orders.guestOrder.status, status)) {
      await updateGuestOrderStatus(
        supabaseAdmin as unknown as SupabaseServerClient,
        orders.guestOrder.id,
        status,
      );
      console.log(`[money] guest order ${orders.guestOrder.id} → ${status}`);
    } else {
      console.warn(
        `[money] refusing to promote guest order ${orders.guestOrder.id} from '${orders.guestOrder.status}' to '${status}'`,
      );
    }
  }
}

/**
 * Recompute the buyer's entitlement from the charge, and write it.
 *
 * There is no "mark refunded" / "restore" pair any more: those verbs did not
 * compose, and their non-composition is what handed a fully refunded buyer
 * permanent access when the dispute they had opened was later won. The status is
 * a pure function of three facts (`resolveOrderStatus`), so applying it twice, or
 * out of order, lands in the same place.
 */
async function syncOrderAccess(
  orders: ResolvedOrders,
  charge: Stripe.Charge,
  disputeFacts: { chargebackOpen: boolean; chargebackLost: boolean },
  metadata?: Record<string, unknown>,
): Promise<ClawbackOrderStatus> {
  const status = resolveOrderStatus({
    fullyRefunded: isFullyRefunded(charge.amount, charge.amount_refunded),
    chargebackOpen: disputeFacts.chargebackOpen,
    chargebackLost: disputeFacts.chargebackLost,
  });
  await moveOrdersTo(orders, status, metadata);
  return status;
}

/**
 * The disputed/refunded charge as Stripe currently sees it.
 *
 * ⚠️ **A dispute event does not carry the charge total, and `dispute.amount` is
 * NOT it** — the SDK documents it as "usually the amount of the charge, but it can
 * differ". Using it as the denominator made every proportion exactly 1, so a
 * partial chargeback clawed back 100% of the photographer's payout.
 *
 * Returns `null` when Stripe cannot be reached, and the caller must then touch
 * NOTHING: an unknown denominator has no safe numeric substitute, and the previous
 * attempt to give it one (`?? 0`) read as "nothing was refunded" and left the
 * money fully payable.
 */
async function fetchCharge(chargeId: string): Promise<Stripe.Charge | null> {
  try {
    return await stripe.charges.retrieve(chargeId);
  } catch (err) {
    console.error(`[money] could not retrieve charge ${chargeId}:`, err);
    return null;
  }
}

/**
 * Whether a real (non-inquiry) chargeback is open or lost on this charge right
 * now — the facts `resolveOrderStatus` needs that the current event may not carry.
 *
 * Fetched rather than remembered: a stored flag would have to be kept in step
 * across redeliveries and out-of-order events, which is the class of bug this
 * redesign exists to remove.
 */
async function fetchDisputeFacts(
  chargeId: string,
): Promise<{ chargebackOpen: boolean; chargebackLost: boolean; lostAmountCents: number }> {
  try {
    const disputes = await stripe.disputes.list({ charge: chargeId, limit: 10 });
    let chargebackOpen = false;
    let chargebackLost = false;
    let lostAmountCents = 0;
    for (const d of disputes.data) {
      if (!isChargeback(d.status)) continue;
      if (d.status === 'lost') {
        chargebackLost = true;
        lostAmountCents += d.amount;
      } else if (isDisputeOpen(d.status)) {
        chargebackOpen = true;
      }
    }
    return { chargebackOpen, chargebackLost, lostAmountCents };
  } catch (err) {
    // ⚠️ These defaults are NOT conservative, and an earlier version of this
    // comment claimed they were. "No disputes" is the most permissive answer this
    // function can give: it is what makes `resolveOrderStatus` return `completed`.
    // Two things keep that from becoming a restored entitlement, and both are
    // required — do not remove either believing this fallback is safe:
    //
    //   1. Each caller folds in what ITS OWN event proves (a `lost` close is
    //      authoritative that a chargeback was lost, whatever the listing says).
    //   2. `mayWriteOrderStatus` refuses to promote anything this flow did not
    //      itself revoke.
    //
    // Throwing instead would 500 the webhook and redeliver a money operation over
    // a read that is not load-bearing for the money half, which is worse.
    console.error(`[money] could not list disputes for charge ${chargeId}:`, err);
    return { chargebackOpen: false, chargebackLost: false, lostAmountCents: 0 };
  }
}

/** The payment intent behind a dispute, which Stripe nests on the charge. */
function disputePaymentIntent(dispute: Stripe.Dispute): string | null {
  if (typeof dispute.payment_intent === 'string') return dispute.payment_intent;
  if (dispute.payment_intent?.id) return dispute.payment_intent.id;
  if (typeof dispute.charge !== 'string' && dispute.charge?.payment_intent) {
    const pi = dispute.charge.payment_intent;
    return typeof pi === 'string' ? pi : (pi?.id ?? null);
  }
  return null;
}

/**
 * What Stripe charged us for handling the dispute.
 *
 * Recorded, never passed on: the photographer controls neither the buyer's fraud
 * nor the dispute process, and a €15 fee against a €5 photo would leave them
 * deeply negative for something they could not have prevented. Absent when the
 * balance transactions aren't expanded, which is why this returns 0 rather than
 * guessing a number onto the order.
 */
function disputeFeeCents(dispute: Stripe.Dispute): number {
  return (dispute.balance_transactions ?? []).reduce((sum, bt) => sum + Math.abs(bt.fee ?? 0), 0);
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
      // or Stripe redelivers and we retry a payment we may have made.
      console.error(`[payouts] failed to open payout row for photographer ${status.id}:`, err);
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
      await holdPayoutRow(supabaseAdmin, payout.id, 'transfer_failed').catch((holdErr) =>
        console.error(`[payouts] failed to hold payout ${payout?.id}:`, holdErr),
      );
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
            console.error(
              `No charge ID on payment_intent ${paymentIntent.id} — cannot create transfers`,
            );
            break;
          }

          const { data: orderItems } = await supabaseAdmin
            .from('order_items')
            .select('photographer_id, total_price_cents')
            .eq('order_id', order.id);

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

        // T-215: unwind BOTH kinds of photographer money for this charge —
        // outstanding holds (reduced proportionally, or voided on a full refund)
        // and transfers already sent (reversed at Stripe). Before this, only the
        // first half existed, and it voided the whole hold even for a partial
        // refund; the second half was a comment telling a human to go and reverse
        // it in the Stripe Dashboard.
        //
        // Everything is driven from a TARGET resolved out of Stripe's own state,
        // never a delta applied to whatever the row currently holds — Stripe
        // redelivers for up to three days, and the access half below makes that
        // routine on purpose.
        const orderForCharge = await resolveOrdersForCharge(charge.payment_intent);
        const orderRef = orderForCharge.order?.id ?? orderForCharge.guestOrder?.id ?? null;

        // A dispute may already be open or lost on this charge — refunding to
        // settle a chargeback is the normal path — so both contribute to the
        // target and to the access decision.
        const disputeFacts = await fetchDisputeFacts(charge.id);
        const target = resolveClawbackTarget({
          chargeAmountCents: charge.amount,
          chargeAmountRefundedCents: charge.amount_refunded,
          disputeLostAmountCents: disputeFacts.chargebackLost ? disputeFacts.lostAmountCents : 0,
        });

        if (!target) {
          // No denominator ⇒ no proportion ⇒ touch nothing. There is deliberately
          // no numeric fallback: the previous one (`?? 0`) read as "nothing was
          // refunded" and left the money fully payable while reporting success.
          await reportMoneyIncident({
            kind: 'needs-reconciliation',
            message:
              'A refund arrived for a charge whose total could not be resolved; no money was clawed back.',
            context: { chargeId: charge.id, orderId: orderRef },
          });
        } else {
          // `applyClawback` never throws — a 500 here makes Stripe redeliver a
          // money operation — so failures come back as `needsReconciliation`.
          await applyClawback({
            supabase: supabaseAdmin as unknown as SupabaseServerClient,
            stripeChargeId: charge.id,
            target,
            reason: 'refund',
            orderId: orderRef,
          });
        }

        // Access. Money first, access second, and this half is allowed to throw:
        // a 500 makes Stripe redeliver, which is the only retry that ever revokes
        // a refunded buyer's access when the database is briefly unavailable.
        //
        // ⚠️ A PARTIAL refund does not revoke. Stripe refunds are amounts, not
        // line items, so nothing says which photos one covers — and revoking the
        // whole order dropped the entire sale out of the photographer's `net`
        // while only the refunded fraction left `paidOut`, quietly eating the
        // difference from their other earnings.
        assertOrdersResolved(orderForCharge);
        await syncOrderAccess(orderForCharge, charge, disputeFacts, {
          refunded_at: new Date().toISOString(),
        });
        break;
      }

      // --- DISPUTE EVENTS ----------------------------------------------
      // A chargeback is forced unilaterally through the buyer's bank: it never
      // passes through our terms or our refund policy, which makes it the obvious
      // route for someone who wants to download without paying. Until T-215 the
      // webhook handled neither event, so a lost dispute took the money back out
      // of the platform account, charged a ~€15 fee, and left the buyer with
      // permanent download access and the photographer with their transfer.
      // ⚠️ ONE body for both, and that is the whole fix for escalation. A bank
      // inquiry that turns into a real chargeback does NOT announce itself with a
      // new event — it arrives as `charge.dispute.updated` carrying a status that
      // has moved out of the `warning_*` family. Handling only `created` meant the
      // buyer kept downloading for the entire chargeback (weeks), because the
      // inquiry branch deliberately leaves access alone and nothing revisited it
      // until `closed`.
      //
      // Sharing the body is safe precisely because it is idempotent: the freeze
      // matches only outstanding holds and access is recomputed from Stripe's
      // facts, so an `updated` that changes nothing we care about (evidence
      // submitted, say) re-derives the same state.
      case 'charge.dispute.created':
      case 'charge.dispute.updated': {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
        const orders = await resolveOrdersForCharge(disputePaymentIntent(dispute));
        const orderRef = orders.order?.id ?? orders.guestOrder?.id ?? null;
        const chargeback = isChargeback(dispute.status);

        // Freeze unsent money for the duration — ALWAYS, inquiry or not. Holding a
        // payout is reversible and cheap; paying one out on a charge that then
        // becomes a chargeback is not. Scoped to this dispute id so closing it
        // clears exactly these rows and never a hold voided by a refund.
        //
        // ⚠️ `revokesAccess` is not a detail: it decides whether the hold leaves
        // `pending`, which has to mirror whether the sale leaves the photographer's
        // `net`. See the note on `freezeHoldsForCharge`.
        try {
          await freezeHoldsForCharge(
            supabaseAdmin as unknown as SupabaseServerClient,
            chargeId,
            dispute.id,
            { revokesAccess: chargeback },
          );
        } catch (err) {
          console.error(`[payouts] failed to freeze holds for disputed charge ${chargeId}:`, err);
        }

        await reportMoneyIncident({
          kind: 'dispute-opened',
          message: chargeback
            ? 'A chargeback was opened; buyer access revoked pending the outcome.'
            : 'An inquiry was opened; payouts frozen, buyer access left untouched.',
          context: {
            chargeId,
            disputeId: dispute.id,
            disputeStatus: dispute.status,
            amountCents: dispute.amount,
            reason: dispute.reason,
            orderId: orderRef,
          },
        });
        try {
          await sendClawbackAlertEmail({
            kind: 'dispute-opened',
            summary: chargeback
              ? 'A chargeback was opened. Buyer access is revoked pending the outcome.'
              : 'An inquiry was opened. Payouts are frozen; the buyer keeps their photos.',
            details: {
              chargeId,
              disputeId: dispute.id,
              disputeStatus: dispute.status,
              amountCents: dispute.amount,
              reason: dispute.reason,
            },
          });
        } catch (err) {
          console.error('[money] failed to send dispute-opened alert', err);
        }

        // ⚠️ Access moves only for a REAL chargeback. Inquiries arrive through this
        // same event, and revoking a paying buyer's photos over a bank's suspicion
        // — one that frequently closes by itself — is real damage; `warning_closed`
        // restored nothing, so it was also permanent.
        if (chargeback) {
          assertOrdersResolved(orders);
          const charge = await fetchCharge(chargeId);
          if (charge) {
            await syncOrderAccess(
              orders,
              charge,
              { chargebackOpen: true, chargebackLost: false },
              { disputed_at: new Date().toISOString(), dispute_id: dispute.id },
            );
          } else {
            // We know a chargeback is open even if the charge could not be read,
            // and revocation must not wait on Stripe being reachable.
            await moveOrdersTo(orders, 'disputed', {
              disputed_at: new Date().toISOString(),
              dispute_id: dispute.id,
            });
          }
        }
        break;
      }

      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
        const orders = await resolveOrdersForCharge(disputePaymentIntent(dispute));
        const orderRef = orders.order?.id ?? orders.guestOrder?.id ?? null;
        const lost = dispute.status === 'lost';

        // Money. A lost dispute joins the reversal target; every other closing
        // state (`won`, `warning_closed`, `prevented`) releases the freeze and
        // leaves the refund accounting exactly where it was.
        const charge = await fetchCharge(chargeId);
        const target = charge
          ? resolveClawbackTarget({
              chargeAmountCents: charge.amount,
              chargeAmountRefundedCents: charge.amount_refunded,
              disputeLostAmountCents: lost ? dispute.amount : 0,
            })
          : null;

        if (lost) {
          if (!target) {
            await reportMoneyIncident({
              kind: 'needs-reconciliation',
              message:
                'A dispute was lost but the charge total could not be resolved; no money was clawed back.',
              context: { chargeId, disputeId: dispute.id, orderId: orderRef },
            });
          } else {
            const outcome = await applyClawback({
              supabase: supabaseAdmin as unknown as SupabaseServerClient,
              stripeChargeId: chargeId,
              target,
              reason: 'dispute',
              orderId: orderRef,
            });

            // The dispute fee is a PLATFORM cost, deliberately not passed on: the
            // photographer controls neither the buyer's fraud nor the dispute
            // process, and a €15 fee on a €5 photo would leave them deeply
            // negative for something they could not have prevented.
            const feeCents = disputeFeeCents(dispute);
            await reportMoneyIncident({
              kind: 'dispute-lost',
              message: 'A chargeback was lost; the photographer transfer was reversed.',
              context: {
                chargeId,
                disputeId: dispute.id,
                orderId: orderRef,
                amountCents: dispute.amount,
                disputeFeeCents: feeCents,
                reversedRows: outcome.reversed,
                reversedCents: outcome.reversedCents,
                needsReconciliation: outcome.needsReconciliation,
              },
            });
            try {
              await sendClawbackAlertEmail({
                kind: 'dispute-lost',
                summary:
                  'A chargeback was lost. The photographer transfer was reversed and the platform absorbed the dispute fee.',
                details: {
                  chargeId,
                  disputeId: dispute.id,
                  orderId: orderRef,
                  amountCents: dispute.amount,
                  disputeFeeCents: feeCents,
                  reversedCents: outcome.reversedCents,
                  needsReconciliation: outcome.needsReconciliation,
                },
              });
            } catch (err) {
              console.error('[money] failed to send dispute-lost alert', err);
            }
          }
        } else {
          // Not lost: release the freeze this dispute put on. Scoped by dispute id,
          // so a hold voided by a real refund stays voided.
          try {
            const restored = await restoreHoldsForCharge(
              supabaseAdmin as unknown as SupabaseServerClient,
              chargeId,
              dispute.id,
            );
            if (restored > 0) {
              console.log(
                `[payouts] unfroze ${restored} hold(s) after dispute ${dispute.id} closed as '${dispute.status}'`,
              );
            }
          } catch (err) {
            console.error(`[payouts] failed to unfreeze holds for dispute ${dispute.id}:`, err);
          }

          // ⚠️ Unfreezing is not the end of it: a refund may have landed WHILE the
          // hold was frozen, and the refund path only touches `pending` rows, so
          // it could not have seen it. Reconciling right after the unfreeze is
          // what makes "restore" mean "return the row to whatever the refund
          // accounting says", rather than "give it back at full value" — which
          // paid the photographer in full for a sale that had been refunded in
          // full to settle the very dispute being closed.
          if (target && target.reversedCents > 0) {
            await applyClawback({
              supabase: supabaseAdmin as unknown as SupabaseServerClient,
              stripeChargeId: chargeId,
              target,
              reason: 'refund',
              orderId: orderRef,
            });
          }

          await reportMoneyIncident({
            kind: 'dispute-won',
            message: `A dispute closed as '${dispute.status}'; payouts unfrozen and access recomputed.`,
            context: {
              chargeId,
              disputeId: dispute.id,
              disputeStatus: dispute.status,
              orderId: orderRef,
            },
          });
        }

        // Access, recomputed from the facts rather than "restored". A dispute that
        // was settled BY refunding the buyer closes in our favour, and the old
        // unconditional flip back to `completed` handed that refunded buyer
        // permanent access to the originals.
        assertOrdersResolved(orders);
        if (charge) {
          const facts = await fetchDisputeFacts(chargeId);
          // ⚠️ THIS event is authoritative about THIS dispute, and the listing is
          // not. `fetchDisputeFacts` swallows a Stripe read error into "no
          // disputes", and a lost chargeback carries no refund — so on a failed
          // read the three facts all come back false, `resolveOrderStatus` returns
          // `completed`, and the buyer who just won a chargeback against us gets
          // their access back for good, after we already reversed the money and
          // paid the fee. Fold in what the event itself proves.
          await syncOrderAccess(
            orders,
            charge,
            { ...facts, chargebackLost: facts.chargebackLost || lost },
            {
              dispute_id: dispute.id,
              dispute_status: dispute.status,
              dispute_closed_at: new Date().toISOString(),
              ...(lost ? { dispute_fee_cents: disputeFeeCents(dispute) } : {}),
            },
          );
        } else {
          await reportMoneyIncident({
            kind: 'needs-reconciliation',
            message:
              'A dispute closed but the charge could not be read, so buyer access was left as it was.',
            context: { chargeId, disputeId: dispute.id, orderId: orderRef },
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
