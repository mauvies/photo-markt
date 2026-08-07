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
          // A real charge always carries both; the total is the denominator of
          // every clawback proportion and the proof that a refund was FULL.
          amount: 500,
          amount_refunded: 500,
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
 * T-215 (+T-237) — clawback, after the redesign.
 *
 * The first implementation applied a delta once per event. Two review passes
 * found fifteen money defects in it, so these tests pin the properties the
 * delta model could not have: the same event applied repeatedly moves money
 * once, refunds and disputes compose in any order, an unknown charge total
 * moves nothing at all, and an inquiry is not a chargeback.
 */
describe('app/api/stripe/webhook — clawback (T-215)', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  let restoreStripeReads: (() => void) | null = null;

  afterEach(() => {
    restoreStripeReads?.();
    restoreStripeReads = null;
  });

  /**
   * Stub the two Stripe reads the clawback makes: the charge (its total is the
   * denominator of every proportion) and the dispute list (the access facts).
   * Both are fetched rather than read off the event, because `dispute.amount` is
   * the DISPUTED amount — the SDK documents it as "usually the amount of the
   * charge, but it can differ" — and because a stored flag cannot survive
   * redelivery and out-of-order events.
   *
   * Restored in `afterEach`, never by the caller: a test that fails before a
   * manual restore leaves the spy installed, and the next `clearAllMocks` empties
   * its implementation, so the charge read returns `undefined` and every later
   * test sees the clawback correctly refusing to guess — test pollution that
   * reads exactly like a product bug.
   */
  async function stubStripeReads(opts: {
    chargeId: string;
    amount: number;
    amountRefunded?: number;
    disputes?: Array<{ status: string; amount: number }>;
  }) {
    const { stripe: stripeClient } = await import('@/lib/stripe/config');
    const chargeSpy = vi.spyOn(stripeClient.charges, 'retrieve').mockResolvedValue({
      id: opts.chargeId,
      amount: opts.amount,
      amount_refunded: opts.amountRefunded ?? 0,
    } as never);
    const disputeSpy = vi
      .spyOn(stripeClient.disputes, 'list')
      .mockResolvedValue({ data: opts.disputes ?? [] } as never);
    restoreStripeReads = () => {
      chargeSpy.mockRestore();
      disputeSpy.mockRestore();
    };
  }

  /** A completed sale with one payout row: `paid` = money sent, `pending` = held. */
  async function seedCharge(opts: {
    chargeId: string;
    paymentIntentId: string;
    amountCents: number;
    payoutStatus: 'paid' | 'pending';
    payoutAmountCents: number;
    holdReason?: string;
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
          : { hold_reason: opts.holdReason ?? 'connect_inactive' }),
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
    eventId?: string;
  }) {
    return signedWebhookRequest({
      id: opts.eventId ?? `evt_refund_${opts.chargeId}`,
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
    status: string;
  }) {
    return signedWebhookRequest({
      id: `evt_${opts.type}_${opts.chargeId}_${opts.status}`,
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
          status: opts.status,
          balance_transactions: [{ fee: 1500 }],
        },
      },
    });
  }

  it('reverses in full and voids the hold on a FULL refund', async () => {
    const { sb, payout } = await seedCharge({
      chargeId: 'ch_full_refund',
      paymentIntentId: 'pi_full_refund',
      amountCents: 2000,
      payoutStatus: 'paid',
      payoutAmountCents: 1840,
    });
    await stubStripeReads({ chargeId: 'ch_full_refund', amount: 2000, amountRefunded: 2000 });

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

  it('IS IDEMPOTENT: three redeliveries of one partial refund claw back once', async () => {
    // The defect this replaces: the reduction was computed from the row's CURRENT
    // amount, so each redelivery reduced it again — 2000 → 1500 → 1125 → 844 on a
    // single €5 refund. Redelivery is routine here, because the access half
    // deliberately fails the request on a transient DB error.
    const { sb, payout } = await seedCharge({
      chargeId: 'ch_idem',
      paymentIntentId: 'pi_idem',
      amountCents: 2000,
      payoutStatus: 'pending',
      payoutAmountCents: 1000,
    });
    await stubStripeReads({ chargeId: 'ch_idem', amount: 2000, amountRefunded: 500 });

    for (let i = 0; i < 3; i += 1) {
      const res = await POST(
        refundRequest({
          chargeId: 'ch_idem',
          paymentIntentId: 'pi_idem',
          amountCents: 2000,
          refundedCents: 500,
        }),
      );
      expect(res.status).toBe(200);
    }

    const { data: after } = await sb
      .from('payouts')
      .select('status, amount_cents, reversed_amount_cents')
      .eq('id', payout.id)
      .single();
    // `amount_cents` is immutable; the clawback lives in `reversed_amount_cents`.
    expect(after?.amount_cents).toBe(1000);
    expect(after?.reversed_amount_cents).toBe(250);
    expect(after?.status).toBe('pending');
  });

  it('does NOT revoke access on a partial refund', async () => {
    // Stripe refunds are amounts, not line items, so nothing says which photos a
    // partial refund covers — and revoking the whole order dropped the entire
    // sale out of the photographer's `net` while only the refunded fraction left
    // `paidOut`, eating the difference from their other earnings.
    const { sb, order } = await seedCharge({
      chargeId: 'ch_part_access',
      paymentIntentId: 'pi_part_access',
      amountCents: 2000,
      payoutStatus: 'paid',
      payoutAmountCents: 1840,
    });
    await stubStripeReads({ chargeId: 'ch_part_access', amount: 2000, amountRefunded: 500 });

    await POST(
      refundRequest({
        chargeId: 'ch_part_access',
        paymentIntentId: 'pi_part_access',
        amountCents: 2000,
        refundedCents: 500,
      }),
    );

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('completed');
  });

  it('freezes the payout but KEEPS access when an inquiry is opened', async () => {
    // Inquiries arrive through the same event as chargebacks. Revoking a paying
    // buyer's photos over a bank's suspicion — one that often closes by itself —
    // was real damage, and `warning_closed` restored nothing.
    const { sb, order, payout } = await seedCharge({
      chargeId: 'ch_inquiry',
      paymentIntentId: 'pi_inquiry',
      amountCents: 500,
      payoutStatus: 'pending',
      payoutAmountCents: 460,
    });
    await stubStripeReads({
      chargeId: 'ch_inquiry',
      amount: 500,
      disputes: [{ status: 'warning_needs_response', amount: 500 }],
    });

    expect(
      (
        await POST(
          disputeRequest({
            type: 'charge.dispute.created',
            chargeId: 'ch_inquiry',
            paymentIntentId: 'pi_inquiry',
            amountCents: 500,
            status: 'warning_needs_response',
          }),
        )
      ).status,
    ).toBe(200);

    const { data: duringOrder } = await sb
      .from('orders')
      .select('status')
      .eq('id', order.id)
      .single();
    expect(duringOrder?.status).toBe('completed');

    const { data: duringPayout } = await sb
      .from('payouts')
      .select('status, frozen_by_dispute_id')
      .eq('id', payout.id)
      .single();
    expect(duringPayout?.status).toBe('cancelled');
    expect(duringPayout?.frozen_by_dispute_id).toBe('dp_ch_inquiry');

    // Closing it releases the freeze and still never touches access.
    await stubStripeReads({ chargeId: 'ch_inquiry', amount: 500, disputes: [] });
    expect(
      (
        await POST(
          disputeRequest({
            type: 'charge.dispute.closed',
            chargeId: 'ch_inquiry',
            paymentIntentId: 'pi_inquiry',
            amountCents: 500,
            status: 'warning_closed',
          }),
        )
      ).status,
    ).toBe(200);

    const { data: afterPayout } = await sb
      .from('payouts')
      .select('status, frozen_by_dispute_id')
      .eq('id', payout.id)
      .single();
    expect(afterPayout?.status).toBe('pending');
    expect(afterPayout?.frozen_by_dispute_id).toBeNull();

    const { data: afterOrder } = await sb
      .from('orders')
      .select('status')
      .eq('id', order.id)
      .single();
    expect(afterOrder?.status).toBe('completed');
  });

  it('revokes access when a real chargeback is opened', async () => {
    const { sb, order } = await seedCharge({
      chargeId: 'ch_disp_open',
      paymentIntentId: 'pi_disp_open',
      amountCents: 500,
      payoutStatus: 'pending',
      payoutAmountCents: 460,
    });
    await stubStripeReads({
      chargeId: 'ch_disp_open',
      amount: 500,
      disputes: [{ status: 'needs_response', amount: 500 }],
    });

    const res = await POST(
      disputeRequest({
        type: 'charge.dispute.created',
        chargeId: 'ch_disp_open',
        paymentIntentId: 'pi_disp_open',
        amountCents: 500,
        status: 'needs_response',
      }),
    );
    expect(res.status).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('disputed');
  });

  it('reverses only its own proportion when a PARTIAL dispute is lost', async () => {
    // `dispute.amount` is the disputed amount, not the charge total. Using it as
    // both made every proportion exactly 1, so a partial chargeback clawed back
    // 100% of the payout.
    const { sb, payout } = await seedCharge({
      chargeId: 'ch_disp_partial',
      paymentIntentId: 'pi_disp_partial',
      amountCents: 2000,
      payoutStatus: 'paid',
      payoutAmountCents: 1000,
    });
    await stubStripeReads({
      chargeId: 'ch_disp_partial',
      amount: 2000,
      disputes: [{ status: 'lost', amount: 500 }],
    });

    expect(
      (
        await POST(
          disputeRequest({
            type: 'charge.dispute.closed',
            chargeId: 'ch_disp_partial',
            paymentIntentId: 'pi_disp_partial',
            amountCents: 500,
            status: 'lost',
          }),
        )
      ).status,
    ).toBe(200);

    const { createTransferReversal } = await import('@/lib/stripe/connect');
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
  });

  it('KEEPS a refunded buyer revoked when the dispute they opened is won', async () => {
    // The sequence that broke the old model: dispute opened → refunded to settle
    // it → the bank closes it in our favour. "Restore" then handed a fully
    // refunded buyer permanent access and re-paid the photographer.
    const { sb, order, payout } = await seedCharge({
      chargeId: 'ch_settle',
      paymentIntentId: 'pi_settle',
      amountCents: 2000,
      payoutStatus: 'pending',
      payoutAmountCents: 1840,
    });

    await stubStripeReads({
      chargeId: 'ch_settle',
      amount: 2000,
      disputes: [{ status: 'needs_response', amount: 2000 }],
    });
    await POST(
      disputeRequest({
        type: 'charge.dispute.created',
        chargeId: 'ch_settle',
        paymentIntentId: 'pi_settle',
        amountCents: 2000,
        status: 'needs_response',
      }),
    );

    // Refund in full to settle it.
    await stubStripeReads({
      chargeId: 'ch_settle',
      amount: 2000,
      amountRefunded: 2000,
      disputes: [{ status: 'needs_response', amount: 2000 }],
    });
    await POST(
      refundRequest({
        chargeId: 'ch_settle',
        paymentIntentId: 'pi_settle',
        amountCents: 2000,
        refundedCents: 2000,
      }),
    );

    // The bank closes it in our favour.
    await stubStripeReads({
      chargeId: 'ch_settle',
      amount: 2000,
      amountRefunded: 2000,
      disputes: [{ status: 'won', amount: 2000 }],
    });
    expect(
      (
        await POST(
          disputeRequest({
            type: 'charge.dispute.closed',
            chargeId: 'ch_settle',
            paymentIntentId: 'pi_settle',
            amountCents: 2000,
            status: 'won',
          }),
        )
      ).status,
    ).toBe(200);

    // Access stays revoked — the buyer got their money back.
    const { data: afterOrder } = await sb
      .from('orders')
      .select('status')
      .eq('id', order.id)
      .single();
    expect(afterOrder?.status).toBe('refunded');

    // And the photographer is not paid for a fully refunded sale.
    const { data: afterPayout } = await sb
      .from('payouts')
      .select('status, reversed_amount_cents')
      .eq('id', payout.id)
      .single();
    expect(afterPayout?.status).toBe('cancelled');
    expect(afterPayout?.reversed_amount_cents).toBe(1840);
  });

  it('claws back NOTHING when the charge total cannot be resolved', async () => {
    // The previous "fail closed" passed `?? 0`, which reads as "nothing was
    // refunded" — so the hold stayed fully payable while the alert said the
    // transfer had been reversed. There is no numeric fallback any more.
    const { sb, payout } = await seedCharge({
      chargeId: 'ch_unknown',
      paymentIntentId: 'pi_unknown',
      amountCents: 500,
      payoutStatus: 'pending',
      payoutAmountCents: 460,
    });

    const { stripe: stripeClient } = await import('@/lib/stripe/config');
    const chargeSpy = vi
      .spyOn(stripeClient.charges, 'retrieve')
      .mockRejectedValue(new Error('stripe is having a bad minute'));
    const disputeSpy = vi
      .spyOn(stripeClient.disputes, 'list')
      .mockResolvedValue({ data: [{ status: 'lost', amount: 500 }] } as never);
    restoreStripeReads = () => {
      chargeSpy.mockRestore();
      disputeSpy.mockRestore();
    };

    expect(
      (
        await POST(
          disputeRequest({
            type: 'charge.dispute.closed',
            chargeId: 'ch_unknown',
            paymentIntentId: 'pi_unknown',
            amountCents: 500,
            status: 'lost',
          }),
        )
      ).status,
    ).toBe(200);

    const { createTransferReversal } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransferReversal)).not.toHaveBeenCalled();

    const { data: after } = await sb
      .from('payouts')
      .select('status, amount_cents, reversed_amount_cents')
      .eq('id', payout.id)
      .single();
    expect(after?.amount_cents).toBe(460);
    expect(after?.reversed_amount_cents).toBe(0);
  });

  it('voids a transfer_failed hold rather than partially reducing it', async () => {
    // Its idempotency key is spent at the original amount, so the only transfer
    // the worker could make is bigger than what is now owed.
    const { sb, payout } = await seedCharge({
      chargeId: 'ch_tf_partial',
      paymentIntentId: 'pi_tf_partial',
      amountCents: 2000,
      payoutStatus: 'pending',
      payoutAmountCents: 1000,
      holdReason: 'transfer_failed',
    });
    await stubStripeReads({ chargeId: 'ch_tf_partial', amount: 2000, amountRefunded: 500 });

    expect(
      (
        await POST(
          refundRequest({
            chargeId: 'ch_tf_partial',
            paymentIntentId: 'pi_tf_partial',
            amountCents: 2000,
            refundedCents: 500,
          }),
        )
      ).status,
    ).toBe(200);

    const { data: after } = await sb
      .from('payouts')
      .select('status, amount_cents, reversed_amount_cents')
      .eq('id', payout.id)
      .single();
    expect(after?.status).toBe('cancelled');
    expect(after?.amount_cents).toBe(1000);
    expect(after?.reversed_amount_cents).toBe(0);
  });

  it('acknowledges the webhook even when the reversal fails', async () => {
    // A 500 would make Stripe redeliver a money operation for up to three days.
    const { sb, payout } = await seedCharge({
      chargeId: 'ch_rev_fail',
      paymentIntentId: 'pi_rev_fail',
      amountCents: 500,
      payoutStatus: 'paid',
      payoutAmountCents: 460,
    });
    await stubStripeReads({ chargeId: 'ch_rev_fail', amount: 500, amountRefunded: 500 });

    const { createTransferReversal } = await import('@/lib/stripe/connect');
    vi.mocked(createTransferReversal).mockRejectedValueOnce(new Error('balance_insufficient'));

    expect(
      (
        await POST(
          refundRequest({
            chargeId: 'ch_rev_fail',
            paymentIntentId: 'pi_rev_fail',
            amountCents: 500,
            refundedCents: 500,
          }),
        )
      ).status,
    ).toBe(200);

    // The reservation is released, so a later reconcile retries with full
    // information rather than believing money came back that never did.
    const { data: after } = await sb
      .from('payouts')
      .select('status, reversed_amount_cents')
      .eq('id', payout.id)
      .single();
    expect(after?.status).toBe('paid');
    expect(after?.reversed_amount_cents).toBe(0);
  });

  it('marks a GUEST order too', async () => {
    // The refund path only ever consulted `orders`, so a refunded guest kept a
    // working download-token page until it expired.
    const sb = createServiceClient();
    const { data: guestOrder } = await sb
      .from('guest_orders')
      .insert({
        guest_email: 'guest@photomarkt.test',
        stripe_checkout_session_id: 'cs_guest_refund',
        stripe_payment_intent_id: 'pi_guest_refund',
        status: 'completed',
        total_amount_cents: 500,
        currency: 'eur',
      })
      .select('id')
      .single();
    if (!guestOrder) throw new Error('guest order seed failed');
    await stubStripeReads({ chargeId: 'ch_guest_refund', amount: 500, amountRefunded: 500 });

    expect(
      (
        await POST(
          refundRequest({
            chargeId: 'ch_guest_refund',
            paymentIntentId: 'pi_guest_refund',
            amountCents: 500,
            refundedCents: 500,
          }),
        )
      ).status,
    ).toBe(200);

    const { data: after } = await sb
      .from('guest_orders')
      .select('status')
      .eq('id', guestOrder.id)
      .single();
    expect(after?.status).toBe('refunded');
  });
});
