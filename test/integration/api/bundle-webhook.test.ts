/**
 * Integration tests for the Stripe webhook's half of volume pricing (T-204).
 *
 * The load-bearing property: the webhook READS the allocation the checkout
 * committed and NEVER recomputes a bundle price from the event's tiers.
 *
 * That is not a performance choice. The ladder is editable at any moment, so a
 * recompute between the charge and the (possibly retried, possibly hours-late)
 * delivery would build an order that disagrees with the buyer's card statement.
 * And because `order_items.total_price_cents` feeds
 * `createTransfersForOrderItems`, list prices on the rows against a discounted
 * charge would transfer money the platform never collected — a loss on every
 * bundled sale. Both are asserted below.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/stripe/connect', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/stripe/connect')>('@/lib/stripe/connect');
  return {
    ...actual,
    createTransfer: vi.fn(async () => ({ id: 'tr_test_mock' }) as unknown),
    reconcileAndPersistConnectStatus: vi.fn(
      async (params: { storedStatus: string }) => params.storedStatus,
    ),
  };
});

vi.mock('@/lib/email/send-guest-purchase-email', () => ({
  sendGuestPurchaseEmail: vi.fn(async () => undefined),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

import Stripe from 'stripe';
import { POST } from '@/app/api/stripe/webhook/route';
import type { BundleTier } from '@/lib/bundle-pricing';
import { getPhotographerNetCents } from '@/lib/plans';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

const WEBHOOK_SECRET = 'whsec_test_dummy_for_tests_at_least_32_chars';

/** €5 a photo · 3+ €12 · 8+ €20 — the design's worked example. */
const LADDER: BundleTier[] = [
  { minQuantity: 3, totalPriceCents: 1200 },
  { minQuantity: 8, totalPriceCents: 2000 },
];

function signedWebhookRequest(event: object): Request {
  const stripe = new Stripe('sk_test_dummy', { apiVersion: '2026-06-24.dahlia' });
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: payload,
  });
}

/**
 * A talent cart of 3 photos on a bundled event, with the 3-photo bundle
 * allocation already committed — exactly the state `createCheckoutSessionAction`
 * leaves behind before creating the session.
 */
async function seedCommittedBundleCart(
  allocations: Array<number | null> = [400, 400, 400],
): Promise<{
  cartId: string;
  talentId: string;
  photographerId: string;
  eventId: string;
  photoIds: string[];
}> {
  const sb = createServiceClient();
  const photographer = await createTestUser('PHOTOGRAPHER');
  await sb
    .from('profiles')
    .update({ stripe_connect_status: 'active', stripe_connect_account_id: 'acct_test_123' })
    .eq('id', photographer.id);
  const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
  await sb.from('events').update({ bundle_tiers: LADDER }).eq('id', event.id);
  const talent = await createTestUser('TALENT');

  const { data: cart } = await sb
    .from('carts')
    .insert({ user_id: talent.id })
    .select('id')
    .single();
  if (!cart) throw new Error('cart seed failed');

  const photoIds: string[] = [];
  for (let i = 0; i < allocations.length; i++) {
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    photoIds.push(photo.id);
    await sb.from('cart_items').insert({
      cart_id: cart.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: 500,
      allocated_price_cents: allocations[i],
    });
  }

  return {
    cartId: cart.id,
    talentId: talent.id,
    photographerId: photographer.id,
    eventId: event.id,
    photoIds,
  };
}

function checkoutCompletedRequest(opts: {
  sessionId: string;
  paymentIntentId: string;
  userId: string;
  cartId: string;
  amountTotal: number;
}) {
  return signedWebhookRequest({
    id: `evt_${opts.sessionId}`,
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.sessionId,
        object: 'checkout.session',
        mode: 'payment',
        client_reference_id: opts.cartId,
        customer: null,
        payment_intent: opts.paymentIntentId,
        amount_total: opts.amountTotal,
        currency: 'eur',
        metadata: { user_id: opts.userId, cart_id: opts.cartId },
      },
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

describe('webhook — authenticated bundled order', () => {
  it('builds order_items from the committed allocation, not the list price', async () => {
    const sb = createServiceClient();
    const { cartId, talentId } = await seedCommittedBundleCart();

    const res = await POST(
      checkoutCompletedRequest({
        sessionId: 'cs_bundle_1',
        paymentIntentId: 'pi_bundle_1',
        userId: talentId,
        cartId,
        amountTotal: 1200,
      }),
    );
    expect(res.status).toBe(200);

    const { data: order } = await sb
      .from('orders')
      .select('id, total_amount_cents')
      .eq('stripe_checkout_session_id', 'cs_bundle_1')
      .single();
    // The discounted total, not 3 × €5.
    expect(order?.total_amount_cents).toBe(1200);

    const { data: items } = await sb
      .from('order_items')
      .select('unit_price_cents, total_price_cents')
      .eq('order_id', order!.id);
    expect(items).toHaveLength(3);
    expect(items?.map((i) => i.unit_price_cents)).toEqual([400, 400, 400]);
    // `total_price_cents` is what the transfer reads, so it has to carry the
    // allocation too.
    expect(items?.reduce((sum, i) => sum + i.total_price_cents, 0)).toBe(1200);
  });

  it('does not change the order when the ladder is edited between charge and delivery', async () => {
    const sb = createServiceClient();
    const { cartId, talentId, eventId } = await seedCommittedBundleCart();

    // The photographer makes the bundle much cheaper AFTER the buyer was charged.
    await sb
      .from('events')
      .update({ bundle_tiers: [{ minQuantity: 3, totalPriceCents: 300 }] })
      .eq('id', eventId);

    await POST(
      checkoutCompletedRequest({
        sessionId: 'cs_bundle_edit',
        paymentIntentId: 'pi_bundle_edit',
        userId: talentId,
        cartId,
        amountTotal: 1200,
      }),
    );

    const { data: order } = await sb
      .from('orders')
      .select('id, total_amount_cents')
      .eq('stripe_checkout_session_id', 'cs_bundle_edit')
      .single();
    // Still the €12 that was actually charged — never the €3 the tiers now say.
    expect(order?.total_amount_cents).toBe(1200);
  });

  it('falls back to the list price when no allocation was committed', async () => {
    const sb = createServiceClient();
    // What a session created before this deploy looks like: null allocations.
    const { cartId, talentId } = await seedCommittedBundleCart([null, null, null]);

    await POST(
      checkoutCompletedRequest({
        sessionId: 'cs_no_alloc',
        paymentIntentId: 'pi_no_alloc',
        userId: talentId,
        cartId,
        amountTotal: 1500,
      }),
    );

    const { data: order } = await sb
      .from('orders')
      .select('id, total_amount_cents')
      .eq('stripe_checkout_session_id', 'cs_no_alloc')
      .single();
    expect(order?.total_amount_cents).toBe(1500);

    const { data: items } = await sb
      .from('order_items')
      .select('unit_price_cents')
      .eq('order_id', order!.id);
    expect(items?.map((i) => i.unit_price_cents)).toEqual([500, 500, 500]);
  });

  it('transfers the photographer their net of the BUNDLE total, never the list total', async () => {
    const sb = createServiceClient();
    const { cartId, talentId, photographerId } = await seedCommittedBundleCart();

    await POST(
      checkoutCompletedRequest({
        sessionId: 'cs_bundle_tx',
        paymentIntentId: 'pi_bundle_tx',
        userId: talentId,
        cartId,
        amountTotal: 1200,
      }),
    );

    const res = await POST(
      signedWebhookRequest({
        id: 'evt_pi_bundle_tx',
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_bundle_tx',
            object: 'payment_intent',
            amount: 1200,
            currency: 'eur',
            latest_charge: 'ch_bundle_tx',
          },
        },
      }),
    );
    expect(res.status).toBe(200);

    const { createTransfer } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransfer)).toHaveBeenCalledTimes(1);
    // No subscription row seeded ⇒ the free plan's commission.
    const expectedNet = getPhotographerNetCents(1200, undefined);
    expect(vi.mocked(createTransfer)).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: expectedNet, destination: 'acct_test_123' }),
    );
    // The list total would have transferred strictly more — the exact loss this
    // allocation exists to prevent.
    expect(expectedNet).toBeLessThan(getPhotographerNetCents(1500, undefined));

    const { data: payouts } = await sb
      .from('payouts')
      .select('amount_cents')
      .eq('photographer_id', photographerId);
    expect(payouts?.map((p) => p.amount_cents)).toEqual([expectedNet]);
  });
});

describe('webhook — guest bundled order', () => {
  it('builds guest_order_items from the allocated cents in the cart metadata', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    await sb.from('events').update({ bundle_tiers: LADDER }).eq('id', event.id);
    const photoIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const photo = await createTestPhoto(event.id, { user_id: photographer.id });
      photoIds.push(photo.id);
    }

    // The `c` field carries the ALLOCATED share (T-204) — €12 split three ways.
    const metadata: Record<string, string> = {
      is_guest: 'true',
      cart_count: '3',
    };
    for (let i = 0; i < 3; i++) {
      metadata[`cart_${i}`] = JSON.stringify({
        p: photoIds[i],
        g: photographer.id,
        c: 400,
      });
    }

    const res = await POST(
      signedWebhookRequest({
        id: 'evt_guest_bundle',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_guest_bundle',
            object: 'checkout.session',
            mode: 'payment',
            payment_intent: null,
            customer: null,
            customer_details: { email: 'guest@example.com' },
            amount_total: 1200,
            currency: 'eur',
            metadata,
          },
        },
      }),
    );
    expect(res.status).toBe(200);

    const { data: order } = await sb
      .from('guest_orders')
      .select('id, total_amount_cents')
      .eq('stripe_checkout_session_id', 'cs_guest_bundle')
      .single();
    expect(order?.total_amount_cents).toBe(1200);

    const { data: items } = await sb
      .from('guest_order_items')
      .select('unit_price_cents')
      .eq('guest_order_id', order!.id);
    expect(items?.map((i) => i.unit_price_cents)).toEqual([400, 400, 400]);
  });
});
