/**
 * Integration tests for `app/api/stripe/webhook/route.ts`.
 *
 * Strategy:
 *   - Signature verification runs real Stripe SDK crypto (no API call). We
 *     sign payloads with the same secret the route reads from `env.mjs`
 *     (set in test/setup.ts).
 *   - Outbound Stripe calls (transfers.create, customers.retrieve) are
 *     mocked via `vi.mock` on the modules that wrap them.
 *   - DB side-effects go to the real local Supabase. Each test seeds its
 *     own fixtures via the test helpers and resets the DB beforehand.
 *
 * These tests pin the security guarantees first (signature can't be
 * bypassed; idempotency holds) and the happy path of each event handler
 * second.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock outbound Stripe Connect calls so the webhook can be exercised
// end-to-end without hitting the real Stripe API. The webhook reads
// `createTransfer` from this module on `payment_intent.succeeded`.
vi.mock('@/lib/stripe/connect', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/stripe/connect')>('@/lib/stripe/connect');
  return {
    ...actual,
    createTransfer: vi.fn(async () => ({ id: 'tr_test_mock' }) as unknown),
    // T-215: clawback reverses a transfer that was already sent. Mocked here so
    // the webhook can be driven end-to-end without touching the real Stripe API.
    createTransferReversal: vi.fn(async () => ({ id: 'trr_test_mock' }) as unknown),
    // Default: passthrough (returns the stored status, no heal). Tests
    // exercising stale-status reconciliation override this per-call.
    // `deriveConnectStatus` (used by the account.updated handler) stays real
    // via `...actual`. The helper's own reconcile/heal logic is covered in
    // test/unit/stripe-connect-reconcile.test.ts.
    reconcileAndPersistConnectStatus: vi.fn(
      async (params: { storedStatus: string }) => params.storedStatus,
    ),
  };
});

// T-216: `account.updated` now asks the retry worker to drain that
// photographer's held payouts. Stub the client so no Inngest network call
// happens; the emit itself is asserted in the ledger tests below.
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn(async () => ({ ids: [] })) },
}));

// Mock Resend so neither purchase path tries to send real email.
vi.mock('@/lib/email/send-guest-purchase-email', () => ({
  sendGuestPurchaseEmail: vi.fn(async () => undefined),
}));
vi.mock('@/lib/email/send-purchase-confirmation-email', () => ({
  sendPurchaseConfirmationEmail: vi.fn(async () => undefined),
}));

// `next/cache` helpers (revalidatePath, revalidateTag) require the Next.js
// render-store context which doesn't exist when calling the route handler
// directly. Replace them with no-ops — the side effect we care about for
// these tests is the DB write, not cache invalidation.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

// Import the handler AFTER the mocks above. Static imports are hoisted by
// Vitest above any vi.mock calls anyway, but importing the test helpers
// here keeps the load order easy to reason about.
import Stripe from 'stripe';
import { POST } from '@/app/api/stripe/webhook/route';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

// Mirror the secret set by test/setup.ts. Keep these in sync if you change
// either side.
const WEBHOOK_SECRET = 'whsec_test_dummy_for_tests_at_least_32_chars';

/**
 * Build a Stripe.Event-shaped object and sign it with the test secret.
 * Returns the `Request` that gets POSTed to the route under test. Uses the
 * real Stripe SDK so signature semantics match production exactly.
 */
function signedWebhookRequest(event: object, opts?: { secret?: string }): Request {
  const stripe = new Stripe('sk_test_dummy', { apiVersion: '2026-06-24.dahlia' });
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: opts?.secret ?? WEBHOOK_SECRET,
  });
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: payload,
  });
}

describe('app/api/stripe/webhook — signature verification', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('rejects requests missing the stripe-signature header', async () => {
    const req = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'noop' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects requests signed with a different secret', async () => {
    const req = signedWebhookRequest(
      {
        id: 'evt_test',
        type: 'noop',
        data: { object: {} },
        created: Math.floor(Date.now() / 1000),
      },
      { secret: 'whsec_completely_different_secret' },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects requests with a valid signature but tampered body', async () => {
    const stripe = new Stripe('sk_test_dummy', { apiVersion: '2026-06-24.dahlia' });
    const original = JSON.stringify({ id: 'evt_test', type: 'noop' });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: original,
      secret: WEBHOOK_SECRET,
    });
    // Send a different body with the original-body's signature → fails the
    // HMAC check. This is the canonical "MITM/replay swap" defense.
    const tampered = JSON.stringify({ id: 'evt_test', type: 'noop', injected: true });
    const req = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: tampered,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('app/api/stripe/webhook — checkout.session.completed (payment mode)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates an order + order_items from the buyer cart and clears it', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');

    // Seed cart with one item — same shape `addPhotoToCart` produces in app code.
    const { data: cart } = await sb
      .from('carts')
      .insert({ user_id: talent.id })
      .select('id')
      .single();
    if (!cart) throw new Error('cart seed failed');
    await sb.from('cart_items').insert({
      cart_id: cart.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: 500,
    });

    const req = signedWebhookRequest({
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cs_test_1',
          object: 'checkout.session',
          mode: 'payment',
          client_reference_id: cart.id,
          customer: null,
          payment_intent: 'pi_test_1',
          amount_total: 500,
          currency: 'eur',
          metadata: { user_id: talent.id, cart_id: cart.id },
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Order exists and is wired to the cart + session.
    const { data: order } = await sb
      .from('orders')
      .select('id, status, total_amount_cents, stripe_checkout_session_id, user_id')
      .eq('stripe_checkout_session_id', 'cs_test_1')
      .single();
    expect(order).not.toBeNull();
    expect(order?.user_id).toBe(talent.id);
    expect(order?.status).toBe('completed');
    expect(order?.total_amount_cents).toBe(500);

    // The single cart item became an order item.
    const { count: itemCount } = await sb
      .from('order_items')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', order!.id);
    expect(itemCount).toBe(1);

    // Cart was cleared.
    const { count: cartItemsRemaining } = await sb
      .from('cart_items')
      .select('*', { count: 'exact', head: true })
      .eq('cart_id', cart.id);
    expect(cartItemsRemaining).toBe(0);
  });

  it('is idempotent — replaying the same event creates only one order', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');
    const { data: cart } = await sb
      .from('carts')
      .insert({ user_id: talent.id })
      .select('id')
      .single();
    if (!cart) throw new Error('cart seed failed');
    await sb.from('cart_items').insert({
      cart_id: cart.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: 500,
    });

    const buildRequest = () =>
      signedWebhookRequest({
        id: 'evt_checkout_dup',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_test_dup',
            object: 'checkout.session',
            mode: 'payment',
            client_reference_id: cart.id,
            payment_intent: 'pi_test_dup',
            amount_total: 500,
            currency: 'eur',
            metadata: { user_id: talent.id, cart_id: cart.id },
          },
        },
      });

    expect((await POST(buildRequest())).status).toBe(200);
    expect((await POST(buildRequest())).status).toBe(200);

    const { count } = await sb
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('stripe_checkout_session_id', 'cs_test_dup');
    expect(count).toBe(1);
  });
});

describe('app/api/stripe/webhook — payment_intent.succeeded', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  it('flips a pending order to completed and triggers transfer creation', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');

    // Wire the photographer's connect account so the transfer path runs.
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_test', stripe_connect_status: 'active' })
      .eq('id', photographer.id);

    // Seed a pending order with one item.
    const { data: order } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status: 'pending',
        total_amount_cents: 500,
        currency: 'eur',
        stripe_payment_intent_id: 'pi_test_pi',
      })
      .select('id')
      .single();
    if (!order) throw new Error('order seed failed');
    await sb.from('order_items').insert({
      order_id: order.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: 500,
      total_price_cents: 500,
    });

    const req = signedWebhookRequest({
      id: 'evt_pi_success',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_test_pi',
          object: 'payment_intent',
          latest_charge: 'ch_test_charge',
          amount: 500,
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('completed');

    // Transfer mock was called for the single photographer.
    const { createTransfer } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransfer)).toHaveBeenCalledTimes(1);
    // T-193: the transfer currency must match the ORDER's charge currency
    // (source_transaction requires it) — a pre-EUR USD order's transfer stays
    // USD instead of being forced to EUR and rejected.
    expect(vi.mocked(createTransfer)).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'eur' }),
    );
  });

  it('reconciles a stale non-active stored status against the live account so the transfer is NOT held', async () => {
    // Regression for T-074: a lagged/missed `account.updated` webhook leaves
    // `stripe_connect_status = 'pending'` for an account that is actually
    // active. Before the fix the gate held the transfer in the platform
    // account (createTransfer never called); after, the live reconcile pays
    // the photographer and heals the cached status.
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');

    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_stale', stripe_connect_status: 'pending' })
      .eq('id', photographer.id);

    // The live account is fully enabled even though the DB still says pending,
    // so the reconcile heals it to active and the gate lets the transfer through.
    const { reconcileAndPersistConnectStatus } = await import('@/lib/stripe/connect');
    vi.mocked(reconcileAndPersistConnectStatus).mockResolvedValueOnce('active');

    const { data: order } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status: 'pending',
        total_amount_cents: 500,
        stripe_payment_intent_id: 'pi_stale_status',
      })
      .select('id')
      .single();
    if (!order) throw new Error('order seed failed');
    await sb.from('order_items').insert({
      order_id: order.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: 500,
      total_price_cents: 500,
    });

    const req = signedWebhookRequest({
      id: 'evt_pi_stale_status',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_stale_status',
          object: 'payment_intent',
          latest_charge: 'ch_stale_status',
          amount: 500,
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // The gate used the reconciled 'active' status: the transfer was created
    // (not held) despite the stale stored 'pending'. The heal-persistence
    // itself is covered by the reconcileAndPersistConnectStatus unit tests.
    const { createTransfer } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransfer)).toHaveBeenCalledTimes(1);

    // The helper was consulted with the stale stored status + account id.
    expect(vi.mocked(reconcileAndPersistConnectStatus)).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct_stale', storedStatus: 'pending' }),
    );
  });
});

describe('app/api/stripe/webhook — account.updated', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("syncs the photographer's connect status to 'active' when the account is fully enabled", async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_evt_updated', stripe_connect_status: 'pending' })
      .eq('id', photographer.id);

    const req = signedWebhookRequest({
      id: 'evt_account_updated',
      type: 'account.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'acct_evt_updated',
          object: 'account',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          requirements: { currently_due: [], past_due: [], disabled_reason: null },
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { data: profile } = await sb
      .from('profiles')
      .select('stripe_connect_status')
      .eq('id', photographer.id)
      .single();
    expect(profile?.stripe_connect_status).toBe('active');
  });
});

describe('app/api/stripe/webhook — charge.refunded', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('marks the matching order as refunded', async () => {
    const sb = createServiceClient();
    const talent = await createTestUser('TALENT');
    const { data: order } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status: 'completed',
        total_amount_cents: 500,
        stripe_payment_intent_id: 'pi_test_refund',
      })
      .select('id')
      .single();
    if (!order) throw new Error('order seed failed');

    const req = signedWebhookRequest({
      id: 'evt_refund',
      type: 'charge.refunded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'ch_test_refund',
          object: 'charge',
          payment_intent: 'pi_test_refund',
          refunded: true,
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('refunded');
  });
});

// The guest-checkout path writes to `guest_orders`, `guest_order_items`,
// and `download_tokens`. Those tables were dropped by the schema dump in
// `20260427162800_remote_schema.sql` and recreated by the compat migration
// `20260514120000_local_reset_compat_recreate_guest_checkout_tables.sql`.
describe('app/api/stripe/webhook — checkout.session.completed (guest mode)', () => {
  let restoreRetrieve: (() => void) | null = null;

  beforeEach(async () => {
    await resetDatabase();
    restoreRetrieve = null;
  });

  afterEach(() => {
    restoreRetrieve?.();
    restoreRetrieve = null;
  });

  it('creates guest_order + guest_order_items + download_token from metadata', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_g', stripe_connect_status: 'active' })
      .eq('id', photographer.id);
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);

    // The transfer creation at the end of the guest path calls
    // stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] }).
    // Stub it so we don't hit the network.
    const { stripe: routeStripe } = await import('@/lib/stripe/config');
    const spy = vi.spyOn(routeStripe.paymentIntents, 'retrieve').mockResolvedValue({
      id: 'pi_guest_1',
      object: 'payment_intent',
      latest_charge: 'ch_guest_1',
    } as never);
    restoreRetrieve = () => spy.mockRestore();

    const req = signedWebhookRequest({
      id: 'evt_guest_checkout',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cs_guest_1',
          object: 'checkout.session',
          mode: 'payment',
          customer: null,
          customer_email: 'guest@photomarkt.test',
          customer_details: { email: 'guest@photomarkt.test' },
          payment_intent: 'pi_guest_1',
          amount_total: 500,
          currency: 'eur',
          metadata: {
            is_guest: 'true',
            cart_count: '1',
            // Compact JSON shape the webhook expects: { p: photoId, g: photographerId, c: unit_cents }
            cart_0: JSON.stringify({ p: photo.id, g: photographer.id, c: 500 }),
          },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    // Guest order created and tied to the session.
    const { data: guestOrder } = await sb
      .from('guest_orders')
      .select('id, guest_email, total_amount_cents')
      .eq('stripe_checkout_session_id', 'cs_guest_1')
      .single();
    expect(guestOrder?.guest_email).toBe('guest@photomarkt.test');
    expect(guestOrder?.total_amount_cents).toBe(500);

    // Single guest_order_item — matches the cart payload.
    const { count: itemCount } = await sb
      .from('guest_order_items')
      .select('*', { count: 'exact', head: true })
      .eq('guest_order_id', guestOrder!.id);
    expect(itemCount).toBe(1);

    // Download token minted for this order.
    const { count: tokenCount } = await sb
      .from('download_tokens')
      .select('*', { count: 'exact', head: true })
      .eq('guest_order_id', guestOrder!.id);
    expect(tokenCount).toBe(1);

    // Transfer mock was invoked for the photographer.
    const { createTransfer } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransfer)).toHaveBeenCalled();
  });

  it('is idempotent — replaying the same guest session does not double-create', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_g2', stripe_connect_status: 'active' })
      .eq('id', photographer.id);
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);

    const { stripe: routeStripe } = await import('@/lib/stripe/config');
    const spy = vi.spyOn(routeStripe.paymentIntents, 'retrieve').mockResolvedValue({
      id: 'pi_guest_dup',
      object: 'payment_intent',
      latest_charge: 'ch_guest_dup',
    } as never);
    restoreRetrieve = () => spy.mockRestore();

    const buildRequest = () =>
      signedWebhookRequest({
        id: 'evt_guest_dup',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_guest_dup',
            object: 'checkout.session',
            mode: 'payment',
            customer: null,
            customer_details: { email: 'dup@photomarkt.test' },
            payment_intent: 'pi_guest_dup',
            amount_total: 500,
            currency: 'eur',
            metadata: {
              is_guest: 'true',
              cart_count: '1',
              cart_0: JSON.stringify({ p: photo.id, g: photographer.id, c: 500 }),
            },
          },
        },
      });

    expect((await POST(buildRequest())).status).toBe(200);
    expect((await POST(buildRequest())).status).toBe(200);

    const { count } = await sb
      .from('guest_orders')
      .select('*', { count: 'exact', head: true })
      .eq('stripe_checkout_session_id', 'cs_guest_dup');
    expect(count).toBe(1);
  });
});

describe('app/api/stripe/webhook — payment_intent.payment_failed', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('flips a pending order to failed and records the failure reason', async () => {
    const sb = createServiceClient();
    const talent = await createTestUser('TALENT');
    const { data: order } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status: 'pending',
        total_amount_cents: 500,
        stripe_payment_intent_id: 'pi_test_failed',
      })
      .select('id')
      .single();
    if (!order) throw new Error('order seed failed');

    const req = signedWebhookRequest({
      id: 'evt_pi_failed',
      type: 'payment_intent.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_test_failed',
          object: 'payment_intent',
          last_payment_error: { message: 'Your card was declined.' },
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('failed');
  });

  it('does NOT touch an order that is already completed (status guard)', async () => {
    // The handler only flips status when the order is currently `pending`.
    // This protects against late-arriving failure events for orders that
    // already settled successfully (out-of-order webhooks happen).
    const sb = createServiceClient();
    const talent = await createTestUser('TALENT');
    const { data: order } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status: 'completed',
        total_amount_cents: 500,
        stripe_payment_intent_id: 'pi_test_late_fail',
      })
      .select('id')
      .single();
    if (!order) throw new Error('order seed failed');

    const req = signedWebhookRequest({
      id: 'evt_pi_late_failed',
      type: 'payment_intent.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_test_late_fail',
          object: 'payment_intent',
          last_payment_error: { message: 'Should not apply.' },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('completed');
  });
});

describe('app/api/stripe/webhook — customer.subscription.* events', () => {
  let restoreCustomersRetrieve: (() => void) | null = null;

  beforeEach(async () => {
    await resetDatabase();
    restoreCustomersRetrieve = null;
  });

  afterEach(() => {
    restoreCustomersRetrieve?.();
    restoreCustomersRetrieve = null;
  });

  /**
   * Stub `stripe.customers.retrieve` to return a fake Customer carrying the
   * given supabase_user_id in metadata. The webhook reads that metadata to
   * resolve the user; without the stub we'd hit the real Stripe API.
   */
  async function stubCustomerRetrieve(supabaseUserId: string) {
    const { stripe: routeStripe } = await import('@/lib/stripe/config');
    const spy = vi.spyOn(routeStripe.customers, 'retrieve').mockResolvedValue({
      id: 'cus_test_mock',
      object: 'customer',
      deleted: false,
      metadata: { supabase_user_id: supabaseUserId },
    } as never);
    restoreCustomersRetrieve = () => spy.mockRestore();
  }

  it('customer.subscription.created inserts a new subscription row', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await stubCustomerRetrieve(photographer.id);

    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    const req = signedWebhookRequest({
      id: 'evt_sub_created',
      type: 'customer.subscription.created',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_test_created',
          object: 'subscription',
          customer: 'cus_test_mock',
          status: 'active',
          current_period_end: periodEnd,
          // STRIPE_PRICE_PRO = 'price_test_pro' per test/setup.ts → maps to 'pro' plan.
          items: { data: [{ price: { id: 'price_test_pro' } }] },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data } = await sb
      .from('subscriptions')
      .select('plan_id, status, stripe_subscription_id, stripe_customer_id, user_id')
      .eq('user_id', photographer.id)
      .single();
    expect(data?.plan_id).toBe('pro');
    expect(data?.status).toBe('active');
    expect(data?.stripe_subscription_id).toBe('sub_test_created');
    expect(data?.stripe_customer_id).toBe('cus_test_mock');
  });

  it('maps the yearly Pro price to plan_id=pro (T-172: yearly price mapping)', async () => {
    // The provisioning code is correct for monthly (covered above); the DoD of
    // T-172 calls out the YEARLY price path explicitly, since yearly is a
    // separate Stripe Price ID (STRIPE_PRICE_PRO_YEARLY = 'price_test_pro_yearly'
    // per test/setup.ts). If the yearly id were missing from STRIPE_PRICE_TO_PLAN,
    // plan_id would fall through to undefined and getCurrentPlan would treat the
    // paying subscriber as Free — the exact money/entitlement failure this
    // ticket guards against. This pins the yearly → pro mapping end-to-end.
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await stubCustomerRetrieve(photographer.id);

    const req = signedWebhookRequest({
      id: 'evt_sub_created_yearly',
      type: 'customer.subscription.created',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_test_created_yearly',
          object: 'subscription',
          customer: 'cus_test_mock',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 365 * 86400,
          items: { data: [{ price: { id: 'price_test_pro_yearly' } }] },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data } = await sb
      .from('subscriptions')
      .select('plan_id, status')
      .eq('user_id', photographer.id)
      .single();
    expect(data?.plan_id).toBe('pro');
    expect(data?.status).toBe('active');
  });

  it('customer.subscription.updated refreshes the existing row in place', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await stubCustomerRetrieve(photographer.id);

    // Seed an initial subscription.
    await sb.from('subscriptions').insert({
      user_id: photographer.id,
      stripe_customer_id: 'cus_test_mock',
      stripe_subscription_id: 'sub_test_update',
      plan_id: 'amateur',
      status: 'trialing',
    });

    const req = signedWebhookRequest({
      id: 'evt_sub_updated',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_test_update',
          object: 'subscription',
          customer: 'cus_test_mock',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          items: { data: [{ price: { id: 'price_test_pro' } }] },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    // Same row (one per user) — plan + status updated; no duplicates created.
    const { data, count } = await sb
      .from('subscriptions')
      .select('plan_id, status', { count: 'exact' })
      .eq('user_id', photographer.id);
    expect(count).toBe(1);
    expect(data?.[0]?.plan_id).toBe('pro');
    expect(data?.[0]?.status).toBe('active');
  });

  it('persists current_period_end from items.data[0] (moved off the root in basil, T-159)', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await stubCustomerRetrieve(photographer.id);

    // Fixed future epoch (seconds) so the assertion is deterministic.
    const periodEnd = 1_924_992_000; // 2031-01-01T00:00:00Z
    const req = signedWebhookRequest({
      id: 'evt_sub_period_end',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_test_period_end',
          object: 'subscription',
          customer: 'cus_test_mock',
          status: 'active',
          // Stripe's `basil` API version (2025-03-31) moved current_period_end
          // off the subscription root onto each item. Deliberately NOT at the
          // root here — the pre-fix code read the (now-absent) root field and
          // wrote null, so this asserts the item is read instead.
          items: {
            data: [{ price: { id: 'price_test_pro' }, current_period_end: periodEnd }],
          },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data } = await sb
      .from('subscriptions')
      .select('current_period_end')
      .eq('user_id', photographer.id)
      .single();
    // Compare as epoch to be robust against timestamptz formatting.
    expect(data?.current_period_end).not.toBeNull();
    expect(new Date(data?.current_period_end as string).getTime()).toBe(periodEnd * 1000);
  });

  it('customer.subscription.deleted marks the subscription as canceled', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await stubCustomerRetrieve(photographer.id);
    await sb.from('subscriptions').insert({
      user_id: photographer.id,
      stripe_customer_id: 'cus_test_mock',
      stripe_subscription_id: 'sub_test_cancel',
      plan_id: 'pro',
      status: 'active',
    });

    const req = signedWebhookRequest({
      id: 'evt_sub_deleted',
      type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_test_cancel',
          object: 'subscription',
          customer: 'cus_test_mock',
          status: 'canceled',
          items: { data: [{ price: { id: 'price_test_pro' } }] },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data } = await sb
      .from('subscriptions')
      .select('status')
      .eq('user_id', photographer.id)
      .single();
    expect(data?.status).toBe('canceled');
  });

  // --- cancel_at_period_end (T-214) ---------------------------------------
  //
  // The webhook is the ONLY writer of this flag: the cancel/reactivate Server
  // Actions ask Stripe and write nothing, so if these handlers don't persist
  // it the pending-cancellation state simply never reaches the UI.

  it('customer.subscription.updated persists a pending cancellation', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await stubCustomerRetrieve(photographer.id);
    await sb.from('subscriptions').insert({
      user_id: photographer.id,
      stripe_customer_id: 'cus_test_mock',
      stripe_subscription_id: 'sub_test_cape',
      plan_id: 'pro',
      status: 'active',
    });

    const req = signedWebhookRequest({
      id: 'evt_sub_cape_true',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_test_cape',
          object: 'subscription',
          customer: 'cus_test_mock',
          status: 'active',
          cancel_at_period_end: true,
          items: { data: [{ price: { id: 'price_test_pro' } }] },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data } = await sb
      .from('subscriptions')
      .select('status, cancel_at_period_end')
      .eq('user_id', photographer.id)
      .single();
    // Still active — cancelling schedules the end of the period, it does not
    // terminate the subscription or downgrade the plan now.
    expect(data?.status).toBe('active');
    expect(data?.cancel_at_period_end).toBe(true);
  });

  it('customer.subscription.updated clears the flag again on reactivation', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await stubCustomerRetrieve(photographer.id);
    await sb.from('subscriptions').insert({
      user_id: photographer.id,
      stripe_customer_id: 'cus_test_mock',
      stripe_subscription_id: 'sub_test_reactivate',
      plan_id: 'pro',
      status: 'active',
      cancel_at_period_end: true,
    });

    const req = signedWebhookRequest({
      id: 'evt_sub_cape_false',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_test_reactivate',
          object: 'subscription',
          customer: 'cus_test_mock',
          status: 'active',
          cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_test_pro' } }] },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data } = await sb
      .from('subscriptions')
      .select('plan_id, status, cancel_at_period_end')
      .eq('user_id', photographer.id)
      .single();
    expect(data?.cancel_at_period_end).toBe(false);
    // Reactivating leaves the subscription exactly as it was.
    expect(data?.plan_id).toBe('pro');
    expect(data?.status).toBe('active');
  });

  it('treats a missing cancel_at_period_end as false rather than null', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await stubCustomerRetrieve(photographer.id);

    const req = signedWebhookRequest({
      id: 'evt_sub_cape_absent',
      type: 'customer.subscription.created',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_test_cape_absent',
          object: 'subscription',
          customer: 'cus_test_mock',
          status: 'active',
          // No `cancel_at_period_end` at all — the column is NOT NULL, so the
          // handler must default rather than send undefined/null.
          items: { data: [{ price: { id: 'price_test_pro' } }] },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data } = await sb
      .from('subscriptions')
      .select('cancel_at_period_end')
      .eq('user_id', photographer.id)
      .single();
    expect(data?.cancel_at_period_end).toBe(false);
  });

  it('persists the flag and the yearly period end together', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await stubCustomerRetrieve(photographer.id);

    // A yearly plan: same flow, the period end is just a year out. No special
    // branch exists and this pins that none is needed.
    const periodEnd = 1_924_992_000; // 2031-01-01T00:00:00Z
    const req = signedWebhookRequest({
      id: 'evt_sub_yearly_cancel',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_test_yearly_cancel',
          object: 'subscription',
          customer: 'cus_test_mock',
          status: 'active',
          cancel_at_period_end: true,
          items: {
            data: [{ price: { id: 'price_test_pro_yearly' }, current_period_end: periodEnd }],
          },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data } = await sb
      .from('subscriptions')
      .select('plan_id, cancel_at_period_end, current_period_end')
      .eq('user_id', photographer.id)
      .single();
    expect(data?.plan_id).toBe('pro');
    expect(data?.cancel_at_period_end).toBe(true);
    expect(new Date(data?.current_period_end as string).getTime()).toBe(periodEnd * 1000);
  });

  it('customer.subscription.deleted clears the pending flag along with the status', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await stubCustomerRetrieve(photographer.id);
    await sb.from('subscriptions').insert({
      user_id: photographer.id,
      stripe_customer_id: 'cus_test_mock',
      stripe_subscription_id: 'sub_test_cape_deleted',
      plan_id: 'pro',
      status: 'active',
      cancel_at_period_end: true,
    });

    const req = signedWebhookRequest({
      id: 'evt_sub_deleted_cape',
      type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_test_cape_deleted',
          object: 'subscription',
          customer: 'cus_test_mock',
          status: 'canceled',
          cancel_at_period_end: true,
          items: { data: [{ price: { id: 'price_test_pro' } }] },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data } = await sb
      .from('subscriptions')
      .select('status, cancel_at_period_end')
      .eq('user_id', photographer.id)
      .single();
    expect(data?.status).toBe('canceled');
    // The subscription is over: there is no cancellation still *pending*, so a
    // finished row must not offer a reactivate Stripe can no longer honour.
    expect(data?.cancel_at_period_end).toBe(false);
  });

  it('falls back to stripe_customer_id lookup when customer metadata lacks supabase_user_id', async () => {
    // Defense path: real Stripe customers occasionally lose metadata (e.g.
    // ones provisioned outside our normal flow). The handler can still
    // resolve the user via an existing subscription row keyed on customer_id.
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');

    // Existing sub provides the customer→user mapping.
    await sb.from('subscriptions').insert({
      user_id: photographer.id,
      stripe_customer_id: 'cus_metadata_lost',
      stripe_subscription_id: 'sub_orig',
      plan_id: 'pro',
      status: 'active',
    });

    const { stripe: routeStripe } = await import('@/lib/stripe/config');
    const spy = vi.spyOn(routeStripe.customers, 'retrieve').mockResolvedValue({
      id: 'cus_metadata_lost',
      object: 'customer',
      deleted: false,
      metadata: {}, // no supabase_user_id
    } as never);
    restoreCustomersRetrieve = () => spy.mockRestore();

    const req = signedWebhookRequest({
      id: 'evt_sub_no_meta',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_orig',
          object: 'subscription',
          customer: 'cus_metadata_lost',
          status: 'past_due',
          current_period_end: Math.floor(Date.now() / 1000),
          items: { data: [{ price: { id: 'price_test_pro' } }] },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    // The status update reached the row, proving the customer_id fallback fired.
    const { data } = await sb
      .from('subscriptions')
      .select('status')
      .eq('user_id', photographer.id)
      .single();
    expect(data?.status).toBe('past_due');
  });
});

/**
 * T-216 — the payout ledger.
 *
 * Before this, the three non-sending exits of `createTransfersForOrderItems`
 * (inactive Connect, sub-50-cent net, transfer threw) did nothing but log. The
 * money stayed in the platform balance with no record and nothing ever retried.
 * These tests pin that each exit now leaves a durable, retryable debt — and,
 * most importantly, that recording it did not open a way to pay twice.
 */
describe('app/api/stripe/webhook — payout ledger (T-216)', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  /** Seed a completed-able order with one item and return its ids. */
  async function seedOrder(opts: {
    connectStatus: string;
    connectAccountId: string | null;
    totalPriceCents: number;
    paymentIntentId: string;
    currency?: string;
  }) {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');

    await sb
      .from('profiles')
      .update({
        stripe_connect_account_id: opts.connectAccountId,
        stripe_connect_status: opts.connectStatus,
      })
      .eq('id', photographer.id);

    const { data: order } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status: 'pending',
        total_amount_cents: opts.totalPriceCents,
        currency: opts.currency ?? 'eur',
        stripe_payment_intent_id: opts.paymentIntentId,
      })
      .select('id')
      .single();
    if (!order) throw new Error('order seed failed');

    await sb.from('order_items').insert({
      order_id: order.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: opts.totalPriceCents,
      total_price_cents: opts.totalPriceCents,
    });

    return { sb, photographer, order };
  }

  function paymentSucceededRequest(opts: { paymentIntentId: string; chargeId: string }) {
    return signedWebhookRequest({
      id: `evt_${opts.paymentIntentId}`,
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: opts.paymentIntentId,
          object: 'payment_intent',
          latest_charge: opts.chargeId,
          amount: 500,
        },
      },
    });
  }

  it('records a hold instead of losing the money when Connect is not active', async () => {
    const { sb, photographer } = await seedOrder({
      connectStatus: 'pending',
      connectAccountId: null,
      totalPriceCents: 500,
      paymentIntentId: 'pi_hold_inactive',
    });

    const res = await POST(
      paymentSucceededRequest({
        paymentIntentId: 'pi_hold_inactive',
        chargeId: 'ch_hold_inactive',
      }),
    );
    expect(res.status).toBe(200);

    const { createTransfer } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransfer)).not.toHaveBeenCalled();

    const { data: payouts } = await sb
      .from('payouts')
      .select('status, amount_cents, hold_reason, stripe_charge_id, currency, order_kind')
      .eq('photographer_id', photographer.id);

    expect(payouts).toHaveLength(1);
    expect(payouts?.[0]?.status).toBe('pending');
    expect(payouts?.[0]?.hold_reason).toBe('connect_inactive');
    // Free plan = 8% commission, so 500 gross nets 460.
    expect(payouts?.[0]?.amount_cents).toBe(460);
    expect(payouts?.[0]?.stripe_charge_id).toBe('ch_hold_inactive');
    expect(payouts?.[0]?.currency).toBe('eur');
    expect(payouts?.[0]?.order_kind).toBe('order');
  });

  it('records a hold when the net is below the Stripe transfer minimum', async () => {
    // 50 gross → 46 net, under Stripe's 50-cent floor. Before T-216 this was
    // warned about and dropped, with no way for it to ever be paid.
    const { sb, photographer } = await seedOrder({
      connectStatus: 'active',
      connectAccountId: 'acct_test',
      totalPriceCents: 50,
      paymentIntentId: 'pi_hold_small',
    });

    expect(
      (
        await POST(
          paymentSucceededRequest({ paymentIntentId: 'pi_hold_small', chargeId: 'ch_hold_small' }),
        )
      ).status,
    ).toBe(200);

    const { createTransfer } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransfer)).not.toHaveBeenCalled();

    const { data: payouts } = await sb
      .from('payouts')
      .select('status, amount_cents, hold_reason')
      .eq('photographer_id', photographer.id);

    expect(payouts).toHaveLength(1);
    expect(payouts?.[0]?.hold_reason).toBe('below_minimum');
    expect(payouts?.[0]?.amount_cents).toBe(46);
  });

  it('leaves one recoverable row (not a second one) when the transfer throws', async () => {
    const { sb, photographer } = await seedOrder({
      connectStatus: 'active',
      connectAccountId: 'acct_test',
      totalPriceCents: 500,
      paymentIntentId: 'pi_throw',
    });

    const { createTransfer } = await import('@/lib/stripe/connect');
    vi.mocked(createTransfer).mockRejectedValueOnce(new Error('stripe is down'));

    expect(
      (await POST(paymentSucceededRequest({ paymentIntentId: 'pi_throw', chargeId: 'ch_throw' })))
        .status,
    ).toBe(200);

    const { data: payouts } = await sb
      .from('payouts')
      .select('status, hold_reason, amount_cents')
      .eq('photographer_id', photographer.id);

    // Exactly one row: the reservation, parked for the retry worker. A second
    // row here would mean the same money could be transferred twice.
    expect(payouts).toHaveLength(1);
    expect(payouts?.[0]?.status).toBe('pending');
    expect(payouts?.[0]?.hold_reason).toBe('transfer_failed');
    expect(payouts?.[0]?.amount_cents).toBe(460);
  });

  it('writes exactly one paid row on the happy path, keyed to the charge', async () => {
    const { sb, photographer } = await seedOrder({
      connectStatus: 'active',
      connectAccountId: 'acct_test',
      totalPriceCents: 500,
      paymentIntentId: 'pi_happy',
    });

    expect(
      (await POST(paymentSucceededRequest({ paymentIntentId: 'pi_happy', chargeId: 'ch_happy' })))
        .status,
    ).toBe(200);

    const { data: payouts } = await sb
      .from('payouts')
      .select('id, status, stripe_transfer_id, stripe_charge_id, amount_cents')
      .eq('photographer_id', photographer.id);

    expect(payouts).toHaveLength(1);
    expect(payouts?.[0]?.status).toBe('paid');
    expect(payouts?.[0]?.stripe_transfer_id).toBe('tr_test_mock');
    expect(payouts?.[0]?.stripe_charge_id).toBe('ch_happy');
    expect(payouts?.[0]?.amount_cents).toBe(460);

    // ⚠️ Cross-writer regression. Stripe compares the WHOLE request body against
    // the one stored under an idempotency key and 400s on divergence, so the key
    // and the transfer_group must BOTH be derived from the payout id — otherwise
    // the retry worker (which sends a payout-derived group) can never re-drive a
    // `transfer_failed` hold. This used to send `transfer_group = orderId`.
    // The worker asserts the identical shape in retry-pending-payouts.test.ts.
    const { createTransfer } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransfer)).toHaveBeenCalledWith(
      expect.objectContaining({
        transferGroup: `payout_${payouts?.[0]?.id}`,
        idempotencyKey: `payout_${payouts?.[0]?.id}`,
        sourceTransaction: 'ch_happy',
      }),
    );
  });

  it('does NOT transfer again when Stripe redelivers a payment already paid out', async () => {
    // ⚠️ The regression this whole design exists for. Stripe retries a failing
    // delivery for up to 3 days — well past its 24h idempotency window — and an
    // operator can resend by hand at any time. With the ledger row written
    // AFTER the transfer, the redelivery would compute a fresh idempotency key
    // and pay the photographer a second time; the unique index would then fire
    // on the log insert and the swallowed 23505 would erase the evidence.
    const { sb, photographer } = await seedOrder({
      connectStatus: 'active',
      connectAccountId: 'acct_test',
      totalPriceCents: 500,
      paymentIntentId: 'pi_redeliver',
    });

    const first = paymentSucceededRequest({
      paymentIntentId: 'pi_redeliver',
      chargeId: 'ch_redeliver',
    });
    expect((await POST(first)).status).toBe(200);

    const { createTransfer } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransfer)).toHaveBeenCalledTimes(1);

    // Same event, delivered again.
    const second = paymentSucceededRequest({
      paymentIntentId: 'pi_redeliver',
      chargeId: 'ch_redeliver',
    });
    expect((await POST(second)).status).toBe(200);

    expect(vi.mocked(createTransfer)).toHaveBeenCalledTimes(1);

    const { data: payouts } = await sb
      .from('payouts')
      .select('id, status')
      .eq('photographer_id', photographer.id);
    expect(payouts).toHaveLength(1);
    expect(payouts?.[0]?.status).toBe('paid');
  });

  it('does NOT transfer when a redelivery arrives after the account went active', async () => {
    // The same race with the worse ending: the first delivery held the money
    // because Connect was inactive. If the retry worker (or an admin) settles it
    // and the account is active by the time Stripe redelivers, the old code
    // would transfer under a key it had never used.
    const { sb, photographer } = await seedOrder({
      connectStatus: 'pending',
      connectAccountId: null,
      totalPriceCents: 500,
      paymentIntentId: 'pi_activate',
    });

    expect(
      (
        await POST(
          paymentSucceededRequest({ paymentIntentId: 'pi_activate', chargeId: 'ch_activate' }),
        )
      ).status,
    ).toBe(200);

    // The worker pays it and the account is now active.
    await sb
      .from('payouts')
      .update({ status: 'paid', stripe_transfer_id: 'tr_by_worker', hold_reason: null })
      .eq('photographer_id', photographer.id);
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_test', stripe_connect_status: 'active' })
      .eq('id', photographer.id);

    expect(
      (
        await POST(
          paymentSucceededRequest({ paymentIntentId: 'pi_activate', chargeId: 'ch_activate' }),
        )
      ).status,
    ).toBe(200);

    const { createTransfer } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransfer)).not.toHaveBeenCalled();

    const { data: payouts } = await sb
      .from('payouts')
      .select('status, stripe_transfer_id')
      .eq('photographer_id', photographer.id);
    expect(payouts).toHaveLength(1);
    expect(payouts?.[0]?.stripe_transfer_id).toBe('tr_by_worker');
  });

  it('asks the retry worker to drain held payouts when an account goes active', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_activate', stripe_connect_status: 'pending' })
      .eq('id', photographer.id);

    const req = signedWebhookRequest({
      id: 'evt_acct_active',
      type: 'account.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'acct_activate',
          object: 'account',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { inngest } = await import('@/lib/inngest/client');
    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith({
      name: 'payouts.retry-requested',
      data: { photographerId: photographer.id },
    });
  });

  it('does not ask for a retry when the account is still not active', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_still_pending', stripe_connect_status: 'pending' })
      .eq('id', photographer.id);

    const req = signedWebhookRequest({
      id: 'evt_acct_pending',
      type: 'account.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'acct_still_pending',
          object: 'account',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: true,
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { inngest } = await import('@/lib/inngest/client');
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it('voids an outstanding hold when its charge is refunded', async () => {
    // Without this, T-216 would CREATE a loss the old code did not have: the
    // retry worker would send a refunded buyer's money to the photographer.
    const { sb, photographer } = await seedOrder({
      connectStatus: 'pending',
      connectAccountId: null,
      totalPriceCents: 500,
      paymentIntentId: 'pi_refund',
    });

    expect(
      (await POST(paymentSucceededRequest({ paymentIntentId: 'pi_refund', chargeId: 'ch_refund' })))
        .status,
    ).toBe(200);

    const { data: held } = await sb
      .from('payouts')
      .select('status')
      .eq('photographer_id', photographer.id)
      .single();
    expect(held?.status).toBe('pending');

    const refundReq = signedWebhookRequest({
      id: 'evt_refunded',
      type: 'charge.refunded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'ch_refund',
          object: 'charge',
          payment_intent: 'pi_refund',
          amount: 500,
          amount_refunded: 500,
        },
      },
    });
    expect((await POST(refundReq)).status).toBe(200);

    const { data: after } = await sb
      .from('payouts')
      .select('status')
      .eq('photographer_id', photographer.id)
      .single();
    expect(after?.status).toBe('cancelled');
  });
});

/**
 * T-215 (absorbing T-237): a purchase that comes back must unwind on BOTH sides —
 * the buyer's access and the photographer's money.
 *
 * Before this, the webhook handled no dispute event at all: a lost chargeback took
 * the money out of the platform account, charged a ~€15 fee, and left the buyer
 * with permanent download access and the photographer with their transfer. And a
 * refund voided the WHOLE outstanding hold even when only part of the charge came
 * back, destroying the photographer's net on the part the buyer never got back
 * (T-237) — irrecoverably, since the exactly-once index blocks inserting a
 * replacement row.
 */
describe('app/api/stripe/webhook — clawback (T-215)', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  /**
   * Seed a photographer with a payout for a charge. `payoutStatus: 'paid'` models
   * money already sent (reversible); `'pending'` models an outstanding hold.
   */
  async function seedCharge(opts: {
    chargeId: string;
    paymentIntentId: string;
    amountCents: number;
    payoutStatus: 'paid' | 'pending';
    payoutAmountCents: number;
  }) {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const talent = await createTestUser('TALENT');

    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_test', stripe_connect_status: 'active' })
      .eq('id', photographer.id);

    const { data: order } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status: 'completed',
        total_amount_cents: opts.amountCents,
        currency: 'eur',
        stripe_payment_intent_id: opts.paymentIntentId,
      })
      .select('id')
      .single();
    if (!order) throw new Error('order seed failed');

    const { data: payout } = await sb
      .from('payouts')
      .insert({
        photographer_id: photographer.id,
        amount_cents: opts.payoutAmountCents,
        currency: 'eur',
        status: opts.payoutStatus,
        stripe_charge_id: opts.chargeId,
        order_id: order.id,
        order_kind: 'order',
        ...(opts.payoutStatus === 'paid'
          ? { stripe_transfer_id: `tr_${opts.chargeId}` }
          : { hold_reason: 'connect_inactive' }),
      })
      .select('id')
      .single();
    if (!payout) throw new Error('payout seed failed');

    return { sb, photographer, order, payout };
  }

  function refundRequest(opts: {
    chargeId: string;
    paymentIntentId: string;
    amountCents: number;
    refundedCents: number;
  }) {
    return signedWebhookRequest({
      id: `evt_refund_${opts.chargeId}`,
      type: 'charge.refunded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: opts.chargeId,
          object: 'charge',
          payment_intent: opts.paymentIntentId,
          amount: opts.amountCents,
          amount_refunded: opts.refundedCents,
        },
      },
    });
  }

  function disputeRequest(opts: {
    type: 'charge.dispute.created' | 'charge.dispute.closed';
    chargeId: string;
    paymentIntentId: string;
    amountCents: number;
    status?: string;
  }) {
    return signedWebhookRequest({
      id: `evt_${opts.type}_${opts.chargeId}`,
      type: opts.type,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `dp_${opts.chargeId}`,
          object: 'dispute',
          charge: opts.chargeId,
          payment_intent: opts.paymentIntentId,
          amount: opts.amountCents,
          reason: 'fraudulent',
          status: opts.status ?? 'needs_response',
          balance_transactions: [{ fee: 1500 }],
        },
      },
    });
  }

  it('revokes access and freezes the hold the moment a dispute is opened', async () => {
    const { sb, order, payout } = await seedCharge({
      chargeId: 'ch_disp_open',
      paymentIntentId: 'pi_disp_open',
      amountCents: 500,
      payoutStatus: 'pending',
      payoutAmountCents: 460,
    });

    const res = await POST(
      disputeRequest({
        type: 'charge.dispute.created',
        chargeId: 'ch_disp_open',
        paymentIntentId: 'pi_disp_open',
        amountCents: 500,
      }),
    );
    expect(res.status).toBe(200);

    // Access: every purchased-photo read gates on `completed`, so this one write
    // is the revocation.
    const { data: afterOrder } = await sb
      .from('orders')
      .select('status')
      .eq('id', order.id)
      .single();
    expect(afterOrder?.status).toBe('disputed');

    // Unsent money: frozen, and marked so a WON dispute can restore exactly this.
    const { data: afterPayout } = await sb
      .from('payouts')
      .select('status, void_reason')
      .eq('id', payout.id)
      .single();
    expect(afterPayout?.status).toBe('cancelled');
    expect(afterPayout?.void_reason).toBe('dispute');
  });

  it('marks a GUEST order disputed too', async () => {
    // The hole T-215 found: no lookup of `guest_orders` by payment intent existed,
    // so a guest kept a working download-token page through a refund or dispute.
    const sb = createServiceClient();
    const { data: guestOrder } = await sb
      .from('guest_orders')
      .insert({
        guest_email: 'guest@photomarkt.test',
        stripe_checkout_session_id: 'cs_disp_guest',
        stripe_payment_intent_id: 'pi_disp_guest',
        status: 'completed',
        total_amount_cents: 500,
        currency: 'eur',
      })
      .select('id')
      .single();
    if (!guestOrder) throw new Error('guest order seed failed');

    const res = await POST(
      disputeRequest({
        type: 'charge.dispute.created',
        chargeId: 'ch_disp_guest',
        paymentIntentId: 'pi_disp_guest',
        amountCents: 500,
      }),
    );
    expect(res.status).toBe(200);

    const { data: after } = await sb
      .from('guest_orders')
      .select('status')
      .eq('id', guestOrder.id)
      .single();
    expect(after?.status).toBe('disputed');
  });

  it('reverses the photographer transfer when a dispute is lost', async () => {
    const { sb, photographer, payout } = await seedCharge({
      chargeId: 'ch_disp_lost',
      paymentIntentId: 'pi_disp_lost',
      amountCents: 500,
      payoutStatus: 'paid',
      payoutAmountCents: 460,
    });

    const { getTotalPaidOut } = await import('@/database/queries/payouts');
    expect(await getTotalPaidOut(sb, photographer.id)).toBe(460);

    // The charge TOTAL comes from Stripe, never from `dispute.amount` — without
    // it the clawback fails closed and reverses nothing, which is the point.
    const { stripe: stripeClient } = await import('@/lib/stripe/config');
    const retrieveSpy = vi
      .spyOn(stripeClient.charges, 'retrieve')
      .mockResolvedValue({ id: 'ch_disp_lost', amount: 500 } as never);

    const res = await POST(
      disputeRequest({
        type: 'charge.dispute.closed',
        chargeId: 'ch_disp_lost',
        paymentIntentId: 'pi_disp_lost',
        amountCents: 500,
        status: 'lost',
      }),
    );
    expect(res.status).toBe(200);
    retrieveSpy.mockRestore();

    const { createTransferReversal } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransferReversal)).toHaveBeenCalledWith(
      expect.objectContaining({ transferId: 'tr_ch_disp_lost', amountCents: 460 }),
    );

    const { data: after } = await sb
      .from('payouts')
      .select('status, reversed_amount_cents, stripe_reversal_id')
      .eq('id', payout.id)
      .single();
    expect(after?.status).toBe('reversed');
    expect(after?.reversed_amount_cents).toBe(460);
    expect(after?.stripe_reversal_id).toBe('trr_test_mock');

    // The photographer's paid-out total has to fall too, or their withdrawable
    // balance is understated by exactly this money forever.
    expect(await getTotalPaidOut(sb, photographer.id)).toBe(0);
  });

  it('restores access and the hold when a dispute is won — but not a refund-voided hold', async () => {
    const { sb, order, payout } = await seedCharge({
      chargeId: 'ch_disp_won',
      paymentIntentId: 'pi_disp_won',
      amountCents: 500,
      payoutStatus: 'pending',
      payoutAmountCents: 460,
    });

    // A second photographer on the same charge, whose hold a real refund voided.
    const other = await createTestUser('PHOTOGRAPHER');
    const { data: refundVoided } = await sb
      .from('payouts')
      .insert({
        photographer_id: other.id,
        amount_cents: 200,
        currency: 'eur',
        status: 'cancelled',
        void_reason: 'refund',
        hold_reason: 'connect_inactive',
        stripe_charge_id: 'ch_disp_won',
      })
      .select('id')
      .single();
    if (!refundVoided) throw new Error('second payout seed failed');

    await POST(
      disputeRequest({
        type: 'charge.dispute.created',
        chargeId: 'ch_disp_won',
        paymentIntentId: 'pi_disp_won',
        amountCents: 500,
      }),
    );
    const res = await POST(
      disputeRequest({
        type: 'charge.dispute.closed',
        chargeId: 'ch_disp_won',
        paymentIntentId: 'pi_disp_won',
        amountCents: 500,
        status: 'won',
      }),
    );
    expect(res.status).toBe(200);

    const { data: afterOrder } = await sb
      .from('orders')
      .select('status')
      .eq('id', order.id)
      .single();
    expect(afterOrder?.status).toBe('completed');

    const { data: restored } = await sb
      .from('payouts')
      .select('status, void_reason')
      .eq('id', payout.id)
      .single();
    expect(restored?.status).toBe('pending');
    expect(restored?.void_reason).toBeNull();

    // The buyer really did get that other money back — winning the dispute must
    // not resurrect it.
    const { data: stillVoid } = await sb
      .from('payouts')
      .select('status')
      .eq('id', refundVoided.id)
      .single();
    expect(stillVoid?.status).toBe('cancelled');
  });

  it('reverses in full and voids the hold on a FULL refund', async () => {
    const { sb, payout } = await seedCharge({
      chargeId: 'ch_full_refund',
      paymentIntentId: 'pi_full_refund',
      amountCents: 2000,
      payoutStatus: 'paid',
      payoutAmountCents: 1840,
    });

    const res = await POST(
      refundRequest({
        chargeId: 'ch_full_refund',
        paymentIntentId: 'pi_full_refund',
        amountCents: 2000,
        refundedCents: 2000,
      }),
    );
    expect(res.status).toBe(200);

    const { createTransferReversal } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransferReversal)).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 1840 }),
    );

    const { data: after } = await sb
      .from('payouts')
      .select('status, reversed_amount_cents')
      .eq('id', payout.id)
      .single();
    expect(after?.status).toBe('reversed');
    expect(after?.reversed_amount_cents).toBe(1840);
  });

  it('reverses PROPORTIONALLY and keeps the hold alive on a partial refund (T-237)', async () => {
    // The regression: before this, ANY `charge.refunded` voided the whole hold, so
    // refunding a quarter of a sale took the photographer's entire net — including
    // their share of the three quarters the buyer never got back.
    const { sb, payout } = await seedCharge({
      chargeId: 'ch_part_refund',
      paymentIntentId: 'pi_part_refund',
      amountCents: 2000,
      payoutStatus: 'paid',
      payoutAmountCents: 1840,
    });

    const other = await createTestUser('PHOTOGRAPHER');
    const { data: hold } = await sb
      .from('payouts')
      .insert({
        photographer_id: other.id,
        amount_cents: 1000,
        currency: 'eur',
        status: 'pending',
        hold_reason: 'connect_inactive',
        stripe_charge_id: 'ch_part_refund',
      })
      .select('id')
      .single();
    if (!hold) throw new Error('hold seed failed');

    const res = await POST(
      refundRequest({
        chargeId: 'ch_part_refund',
        paymentIntentId: 'pi_part_refund',
        amountCents: 2000,
        refundedCents: 500, // a quarter
      }),
    );
    expect(res.status).toBe(200);

    // Money already sent: a quarter of 1840 comes back, three quarters stay.
    const { createTransferReversal } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransferReversal)).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 460 }),
    );
    const { data: reversedRow } = await sb
      .from('payouts')
      .select('status, reversed_amount_cents')
      .eq('id', payout.id)
      .single();
    // Still `paid`, not `reversed` — the photographer genuinely kept the rest.
    expect(reversedRow?.status).toBe('paid');
    expect(reversedRow?.reversed_amount_cents).toBe(460);

    // Money not sent yet: the hold SURVIVES with a reduced amount.
    const { data: reducedHold } = await sb
      .from('payouts')
      .select('status, amount_cents')
      .eq('id', hold.id)
      .single();
    expect(reducedHold?.status).toBe('pending');
    expect(reducedHold?.amount_cents).toBe(750);
  });

  it('acknowledges the webhook even when the reversal fails', async () => {
    // A 500 here would make Stripe redeliver a money operation for up to three
    // days. The failure has to be recorded and alerted, never thrown.
    const { sb, payout } = await seedCharge({
      chargeId: 'ch_rev_fail',
      paymentIntentId: 'pi_rev_fail',
      amountCents: 500,
      payoutStatus: 'paid',
      payoutAmountCents: 460,
    });

    const { createTransferReversal } = await import('@/lib/stripe/connect');
    vi.mocked(createTransferReversal).mockRejectedValueOnce(new Error('balance_insufficient'));

    const res = await POST(
      refundRequest({
        chargeId: 'ch_rev_fail',
        paymentIntentId: 'pi_rev_fail',
        amountCents: 500,
        refundedCents: 500,
      }),
    );
    expect(res.status).toBe(200);

    // The row keeps its state so a reconciliation can retry with full information.
    const { data: after } = await sb
      .from('payouts')
      .select('status, reversed_amount_cents')
      .eq('id', payout.id)
      .single();
    expect(after?.status).toBe('paid');
    expect(after?.reversed_amount_cents).toBe(0);
  });
});

/**
 * Regressions for the defects the T-215 code review found. Each of these passed
 * silently before the fix, and each one moves real money the wrong way.
 */
describe('app/api/stripe/webhook — clawback review regressions (T-215)', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  it('a transfer_failed hold is voided, never reduced, on a partial refund', async () => {
    // Its Stripe idempotency key `payout_<id>` is already spent at the original
    // amount. Reducing it would make the retry worker replay that key with a
    // different body: Stripe 400s for 24h (indistinguishable from an outage) and
    // then issues a genuine SECOND transfer once the key expires.
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const talent = await createTestUser('TALENT');

    const { data: order } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status: 'completed',
        total_amount_cents: 2000,
        currency: 'eur',
        stripe_payment_intent_id: 'pi_tf_partial',
      })
      .select('id')
      .single();
    if (!order) throw new Error('order seed failed');

    const { data: payout } = await sb
      .from('payouts')
      .insert({
        photographer_id: photographer.id,
        amount_cents: 1000,
        currency: 'eur',
        status: 'pending',
        hold_reason: 'transfer_failed',
        stripe_charge_id: 'ch_tf_partial',
        order_id: order.id,
        order_kind: 'order',
      })
      .select('id')
      .single();
    if (!payout) throw new Error('payout seed failed');

    const req = signedWebhookRequest({
      id: 'evt_tf_partial',
      type: 'charge.refunded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'ch_tf_partial',
          object: 'charge',
          payment_intent: 'pi_tf_partial',
          amount: 2000,
          amount_refunded: 500,
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data: after } = await sb
      .from('payouts')
      .select('status, amount_cents, void_reason')
      .eq('id', payout.id)
      .single();
    expect(after?.status).toBe('cancelled');
    // Crucially the amount is UNCHANGED — the spent key still describes it.
    expect(after?.amount_cents).toBe(1000);
    expect(after?.void_reason).toBe('refund');
  });

  it('a PARTIAL dispute reverses its own proportion, not the whole payout', async () => {
    // `dispute.amount` is the disputed amount, not the charge total. Passing it as
    // both made every proportion exactly 1, so a partial chargeback clawed back
    // 100% of the photographer's net.
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const talent = await createTestUser('TALENT');

    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_test', stripe_connect_status: 'active' })
      .eq('id', photographer.id);

    const { data: order } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status: 'completed',
        total_amount_cents: 2000,
        currency: 'eur',
        stripe_payment_intent_id: 'pi_disp_partial',
      })
      .select('id')
      .single();
    if (!order) throw new Error('order seed failed');

    const { data: payout } = await sb
      .from('payouts')
      .insert({
        photographer_id: photographer.id,
        amount_cents: 1000,
        currency: 'eur',
        status: 'paid',
        stripe_transfer_id: 'tr_disp_partial',
        stripe_charge_id: 'ch_disp_partial',
        order_id: order.id,
        order_kind: 'order',
      })
      .select('id')
      .single();
    if (!payout) throw new Error('payout seed failed');

    // The charge total (2000) is fetched from Stripe, not taken from the dispute.
    const { stripe: stripeClient } = await import('@/lib/stripe/config');
    const retrieveSpy = vi
      .spyOn(stripeClient.charges, 'retrieve')
      .mockResolvedValue({ id: 'ch_disp_partial', amount: 2000 } as never);

    const req = signedWebhookRequest({
      id: 'evt_disp_partial',
      type: 'charge.dispute.closed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'dp_disp_partial',
          object: 'dispute',
          charge: 'ch_disp_partial',
          payment_intent: 'pi_disp_partial',
          amount: 500, // a quarter of the charge
          reason: 'fraudulent',
          status: 'lost',
          balance_transactions: [{ fee: 1500 }],
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { createTransferReversal } = await import('@/lib/stripe/connect');
    // A quarter of 1000, not all of it.
    expect(vi.mocked(createTransferReversal)).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 250 }),
    );

    const { data: after } = await sb
      .from('payouts')
      .select('status, reversed_amount_cents')
      .eq('id', payout.id)
      .single();
    expect(after?.status).toBe('paid');
    expect(after?.reversed_amount_cents).toBe(250);

    retrieveSpy.mockRestore();
  });

  it('marks a GUEST order disputed when the lost dispute is the first event seen', async () => {
    // If `charge.dispute.created` was never delivered, `.closed` is the only
    // chance to revoke — and it used to touch `orders` alone.
    const sb = createServiceClient();
    const { data: guestOrder } = await sb
      .from('guest_orders')
      .insert({
        guest_email: 'guest2@photomarkt.test',
        stripe_checkout_session_id: 'cs_disp_lost_guest',
        stripe_payment_intent_id: 'pi_disp_lost_guest',
        status: 'completed',
        total_amount_cents: 500,
        currency: 'eur',
      })
      .select('id')
      .single();
    if (!guestOrder) throw new Error('guest order seed failed');

    const { stripe: stripeClient } = await import('@/lib/stripe/config');
    const retrieveSpy = vi
      .spyOn(stripeClient.charges, 'retrieve')
      .mockResolvedValue({ id: 'ch_disp_lost_guest', amount: 500 } as never);

    const req = signedWebhookRequest({
      id: 'evt_disp_lost_guest',
      type: 'charge.dispute.closed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'dp_disp_lost_guest',
          object: 'dispute',
          charge: 'ch_disp_lost_guest',
          payment_intent: 'pi_disp_lost_guest',
          amount: 500,
          reason: 'fraudulent',
          status: 'lost',
          balance_transactions: [{ fee: 1500 }],
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { data: after } = await sb
      .from('guest_orders')
      .select('status')
      .eq('id', guestOrder.id)
      .single();
    expect(after?.status).toBe('disputed');

    retrieveSpy.mockRestore();
  });
});
