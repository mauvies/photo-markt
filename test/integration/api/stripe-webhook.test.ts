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

// T-249: the ledger writes stay REAL for every other test in this file —
// wrapping the actual implementations in `vi.fn` lets the two silent-failure
// tests force a throw with `mockRejectedValueOnce` without changing behaviour
// anywhere else.
vi.mock('@/database/queries/payouts', async () => {
  const actual = await vi.importActual<typeof import('@/database/queries/payouts')>(
    '@/database/queries/payouts',
  );
  return {
    ...actual,
    openPayoutRow: vi.fn(actual.openPayoutRow),
    holdPayoutRow: vi.fn(actual.holdPayoutRow),
  };
});

// T-249: the alert channel itself is unit-tested; here we only assert that the
// webhook reaches it, so a stub is enough (and keeps Sentry/Resend out of it).
vi.mock('@/lib/observability/report-money-incident', () => ({
  reportMoneyIncident: vi.fn(async () => undefined),
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

    // T-248 — the property that makes selling before onboarding safe is not
    // that a row exists, it is that the row is RECOVERABLE. Now that checkout
    // no longer refuses these sales, this is the ordinary path rather than an
    // edge case, so assert the retry worker's own selector picks it up:
    // `listPayableHolds` requires both a hold reason and a charge id, and a row
    // missing either is money the worker can never pay.
    const { listPayableHolds } = await import('@/database/queries/payouts');
    const payable = await listPayableHolds(sb, 50);
    expect(payable.map((row) => row.stripe_charge_id)).toContain('ch_hold_inactive');
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
 * Shared fixture for the two silent-loss describes below: one photographer with
 * an active Connect account, one 500-cent pending order with a single item.
 * Deliberately module-scoped — both blocks assert on the same shape, and a
 * second copy would let them drift apart as the schema changes.
 */
async function seedPayableOrder(paymentIntentId: string) {
  const sb = createServiceClient();
  const photographer = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(photographer.id);
  const photo = await createTestPhoto(event.id);
  const talent = await createTestUser('TALENT');

  await sb
    .from('profiles')
    .update({ stripe_connect_account_id: 'acct_test', stripe_connect_status: 'active' })
    .eq('id', photographer.id);

  const { data: order } = await sb
    .from('orders')
    .insert({
      user_id: talent.id,
      status: 'pending',
      total_amount_cents: 500,
      currency: 'eur',
      stripe_payment_intent_id: paymentIntentId,
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

  return { sb, photographer, order };
}

/**
 * A sale that skips the photographer's transfer must not do so silently (T-249).
 *
 * The payout ledger is wrapped in `try/catch` + `continue` on purpose — the
 * buyer has already paid, so throwing would make Stripe redeliver a money
 * operation. The cost of that discipline was invisibility: a real sale on
 * 2026-07-28 completed with zero `payouts` rows and nobody knew for thirteen
 * days. These tests pin that the failure now reports, and that reporting it
 * changed nothing else — same 200, same `continue`.
 */
describe('app/api/stripe/webhook — silent payout failures are reported (T-249)', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  function paymentSucceeded(paymentIntentId: string, chargeId: string) {
    return signedWebhookRequest({
      id: `evt_${paymentIntentId}`,
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: paymentIntentId,
          object: 'payment_intent',
          latest_charge: chargeId,
          amount: 500,
        },
      },
    });
  }

  it('reports the incident — and still returns 200 — when the ledger row cannot be opened', async () => {
    const { sb, photographer } = await seedPayableOrder('pi_ledger_down');

    const { openPayoutRow } = await import('@/database/queries/payouts');
    vi.mocked(openPayoutRow).mockRejectedValueOnce(new Error('supabase is down'));

    const res = await POST(paymentSucceeded('pi_ledger_down', 'ch_ledger_down'));

    // The 200 is the whole point of the catch: a 500 makes Stripe redeliver a
    // payment we may already have made. The alert must not change that.
    expect(res.status).toBe(200);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(reportMoneyIncident)).toHaveBeenCalledTimes(1);

    const incident = vi.mocked(reportMoneyIncident).mock.calls[0]?.[0];
    expect(incident?.kind).toBe('payout-not-recorded');
    expect(incident?.context).toMatchObject({
      photographerId: photographer.id,
      chargeId: 'ch_ledger_down',
      netCents: 460,
      currency: 'eur',
    });

    // Nothing was transferred and no debt exists — which is exactly why the
    // alert is the only trace, and why it has to fire.
    const { createTransfer } = await import('@/lib/stripe/connect');
    expect(vi.mocked(createTransfer)).not.toHaveBeenCalled();
    const { data: payouts } = await sb
      .from('payouts')
      .select('id')
      .eq('photographer_id', photographer.id);
    expect(payouts).toHaveLength(0);
  });

  it('reports the incident when a failed transfer cannot even be parked as a hold', async () => {
    const { sb, photographer } = await seedPayableOrder('pi_hold_down');

    const { createTransfer } = await import('@/lib/stripe/connect');
    vi.mocked(createTransfer).mockRejectedValueOnce(new Error('stripe is down'));
    const { holdPayoutRow } = await import('@/database/queries/payouts');
    vi.mocked(holdPayoutRow).mockRejectedValueOnce(new Error('supabase is down'));

    expect((await POST(paymentSucceeded('pi_hold_down', 'ch_hold_down'))).status).toBe(200);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(reportMoneyIncident)).toHaveBeenCalledTimes(1);
    const incident = vi.mocked(reportMoneyIncident).mock.calls[0]?.[0];
    expect(incident?.kind).toBe('payout-not-recorded');
    expect(incident?.context).toMatchObject({ photographerId: photographer.id });

    // The row survives the failure, and THAT is the problem being alerted on:
    // stranded `processing` with no batch id is invisible to both recovery
    // selectors, so without the alert this debt is never paid and never seen.
    const { data: payouts } = await sb
      .from('payouts')
      .select('id, status, hold_reason, transfer_batch_id')
      .eq('photographer_id', photographer.id);
    expect(payouts).toHaveLength(1);
    expect(payouts?.[0]?.status).toBe('processing');
    expect(payouts?.[0]?.transfer_batch_id).toBeNull();

    // Prove the gap rather than asserting it from the schema: neither selector
    // returns this row.
    const { listPayableHolds, listStaleProcessingBatches } = await import(
      '@/database/queries/payouts'
    );
    const payable = await listPayableHolds(sb, 50);
    expect(payable.map((r) => r.id)).not.toContain(payouts?.[0]?.id);
    const stale = await listStaleProcessingBatches(sb, new Date(Date.now() + 60_000).toISOString());
    expect(stale.map((r) => r.id)).not.toContain(payouts?.[0]?.id);
  });

  it('carries no buyer PII into the alert', async () => {
    await seedPayableOrder('pi_pii');

    const { openPayoutRow } = await import('@/database/queries/payouts');
    vi.mocked(openPayoutRow).mockRejectedValueOnce(new Error('supabase is down'));

    await POST(paymentSucceeded('pi_pii', 'ch_pii'));

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    // Assert the call happened before inspecting it — otherwise an absent
    // report would satisfy every "does not contain" check below vacuously.
    expect(vi.mocked(reportMoneyIncident)).toHaveBeenCalledTimes(1);
    const incident = vi.mocked(reportMoneyIncident).mock.calls[0]?.[0];
    expect(incident?.context).toBeDefined();

    // Ids and amounts are fine; anything identifying the buyer is not. The app
    // runs `sendDefaultPii: false` (src/lib/observability/sentry.ts) and this
    // keeps the manual capture honest too.
    const keys = Object.keys(incident?.context ?? {});
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('buyerEmail');
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('userId');
    const serialized = JSON.stringify(incident?.context ?? {});
    expect(serialized).not.toMatch(/@/);
  });

  it('does not alert on the happy path', async () => {
    await seedPayableOrder('pi_quiet');

    expect((await POST(paymentSucceeded('pi_quiet', 'ch_quiet'))).status).toBe(200);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(reportMoneyIncident)).not.toHaveBeenCalled();
  });
});

/**
 * The same money loss, reached by the paths that did not even open a ledger row
 * (T-249, found by review). Each of these completes an order, pays nobody, and
 * before this change said nothing at all — which is a worse failure than the one
 * the ticket started from, because there is not even a `payouts` row to audit.
 */
describe('app/api/stripe/webhook — pre-ledger silent losses are reported (T-249)', () => {
  let restore: (() => void) | null = null;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    restore = null;
  });

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('reports when the payment intent carries no charge id', async () => {
    const { order } = await seedPayableOrder('pi_no_charge');

    const res = await POST(
      signedWebhookRequest({
        id: 'evt_no_charge',
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_no_charge',
            object: 'payment_intent',
            latest_charge: null,
            amount: 500,
          },
        },
      }),
    );
    expect(res.status).toBe(200);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(reportMoneyIncident)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportMoneyIncident).mock.calls[0]?.[0]).toMatchObject({
      kind: 'payout-not-recorded',
      context: { paymentIntentId: 'pi_no_charge', orderId: order.id },
    });
  });

  it('reports when the order items cannot be read at all', async () => {
    const { sb, photographer, order } = await seedPayableOrder('pi_items_unreadable');

    // The quietest failure of the lot: the read errors, `orderItems` falls back
    // to `[]`, and the transfer loop no-ops on the empty list. Simulate the
    // PostgREST failure class T-239 actually hit (a schema-cache error) rather
    // than asserting it from the shape of the code.
    const { supabaseAdmin } = await import('@/database/supabase-admin');
    const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
    const spy = vi
      .spyOn(supabaseAdmin, 'from')
      .mockImplementation((table: Parameters<typeof supabaseAdmin.from>[0]) => {
        if (table !== 'order_items') return realFrom(table);
        return {
          select: () => ({
            eq: async () => ({
              data: null,
              error: { code: 'PGRST002', message: 'Could not query the database for the schema' },
            }),
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>;
      });
    restore = () => spy.mockRestore();

    const res = await POST(
      signedWebhookRequest({
        id: 'evt_items_unreadable',
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_items_unreadable',
            object: 'payment_intent',
            latest_charge: 'ch_items_unreadable',
            amount: 500,
          },
        },
      }),
    );
    expect(res.status).toBe(200);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(reportMoneyIncident)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportMoneyIncident).mock.calls[0]?.[0]).toMatchObject({
      kind: 'payout-not-recorded',
      context: { orderId: order.id, chargeId: 'ch_items_unreadable' },
    });

    spy.mockRestore();
    const { data: payouts } = await sb
      .from('payouts')
      .select('id')
      .eq('photographer_id', photographer.id);
    expect(payouts).toHaveLength(0);
  });

  it('reports when the guest transfer path throws before opening a row', async () => {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_g', stripe_connect_status: 'active' })
      .eq('id', photographer.id);
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);

    // This catch is wider than the authenticated one — it also wraps the
    // PaymentIntent retrieve, so make that the thing that fails.
    const { stripe: routeStripe } = await import('@/lib/stripe/config');
    const spy = vi
      .spyOn(routeStripe.paymentIntents, 'retrieve')
      .mockRejectedValue(new Error('stripe is down'));
    restore = () => spy.mockRestore();

    const res = await POST(
      signedWebhookRequest({
        id: 'evt_guest_transfer_throws',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_guest_throws',
            object: 'checkout.session',
            mode: 'payment',
            customer: null,
            customer_email: 'guest@photomarkt.test',
            customer_details: { email: 'guest@photomarkt.test' },
            payment_intent: 'pi_guest_throws',
            amount_total: 500,
            currency: 'eur',
            metadata: {
              is_guest: 'true',
              cart_count: '1',
              cart_0: JSON.stringify({ p: photo.id, g: photographer.id, c: 500 }),
            },
          },
        },
      }),
    );
    // The guest order is still created and the buyer still gets their photos —
    // only the photographer's money went missing, which is why it must alert.
    expect(res.status).toBe(200);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(reportMoneyIncident)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportMoneyIncident).mock.calls[0]?.[0]).toMatchObject({
      kind: 'payout-not-recorded',
      context: { paymentIntentId: 'pi_guest_throws' },
    });

    const { count } = await sb
      .from('guest_orders')
      .select('*', { count: 'exact', head: true })
      .eq('stripe_checkout_session_id', 'cs_guest_throws');
    expect(count).toBe(1);
  });
});
