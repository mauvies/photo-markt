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
// T-250: only the SEND is stubbed. `notifyPhotographerOfHeldSale` itself stays
// real, so the anti-spam rule is exercised against the real ledger rows and the
// address is resolved through the real RPC.
vi.mock('@/lib/email/send-held-sale-email', () => ({
  sendHeldSaleEmail: vi.fn(async () => undefined),
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
import { getTotalPendingPayouts, listPayableHolds } from '@/database/queries/payouts';
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
  let restoreRetrieve: (() => void) | null = null;

  beforeEach(async () => {
    await resetDatabase();
    // T-252: the authenticated branch now drives the photographer transfers
    // too, which means resolving the charge off the PaymentIntent exactly as
    // the guest branch already did. Stub it so these tests stay off the network.
    const { stripe: routeStripe } = await import('@/lib/stripe/config');
    const spy = vi.spyOn(routeStripe.paymentIntents, 'retrieve').mockResolvedValue({
      id: 'pi_stub',
      object: 'payment_intent',
      latest_charge: 'ch_stub',
    } as never);
    restoreRetrieve = () => spy.mockRestore();
  });

  afterEach(() => {
    restoreRetrieve?.();
    restoreRetrieve = null;
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

  // T-253 — the guest email is the delivery, not a receipt: a guest has no
  // account, so the link it carries is the only route to the photos they paid
  // for. The send stays non-fatal (a 500 makes Stripe redeliver a payment we
  // have taken), which is exactly why the failure has to be REPORTED rather
  // than logged into the void, as it was before this ticket.
  it('reports an incident when the guest delivery email cannot be sent', async () => {
    vi.clearAllMocks();
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_g', stripe_connect_status: 'active' })
      .eq('id', photographer.id);
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);

    const { stripe: routeStripe } = await import('@/lib/stripe/config');
    const spy = vi.spyOn(routeStripe.paymentIntents, 'retrieve').mockResolvedValue({
      id: 'pi_guest_email_fails',
      object: 'payment_intent',
      latest_charge: 'ch_guest_email_fails',
    } as never);
    restoreRetrieve = () => spy.mockRestore();

    const { sendGuestPurchaseEmail } = await import('@/lib/email/send-guest-purchase-email');
    vi.mocked(sendGuestPurchaseEmail).mockRejectedValueOnce(
      new Error('Resend rejected the guest purchase email: Invalid `to` field'),
    );

    const res = await POST(
      signedWebhookRequest({
        id: 'evt_guest_email_fails',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_guest_email_fails',
            object: 'checkout.session',
            mode: 'payment',
            customer: null,
            customer_email: 'guest@photomarkt.test',
            customer_details: { email: 'guest@photomarkt.test' },
            payment_intent: 'pi_guest_email_fails',
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
    expect(res.status).toBe(200);

    const { data: guestOrder } = await sb
      .from('guest_orders')
      .select('id')
      .eq('stripe_checkout_session_id', 'cs_guest_email_fails')
      .single();
    expect(guestOrder?.id).toBeTruthy();

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    const emailIncidents = vi
      .mocked(reportMoneyIncident)
      .mock.calls.map(([incident]) => incident)
      .filter((incident) => incident.kind === 'purchase-email-not-delivered');
    expect(emailIncidents).toHaveLength(1);
    expect(emailIncidents[0]).toMatchObject({
      context: { guestOrderId: guestOrder?.id, sessionId: 'cs_guest_email_fails' },
    });
    // Ids only — the buyer's address and the bearer download token must never
    // ride along in an alert.
    const contextValues = Object.values(emailIncidents[0]?.context ?? {}).map(String);
    expect(contextValues.some((value) => value.includes('@'))).toBe(false);

    // The order still completes and the photographer is still paid — only the
    // delivery email failed.
    const { data: payouts } = await sb
      .from('payouts')
      .select('id')
      .eq('photographer_id', photographer.id);
    expect(payouts).toHaveLength(1);
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

  /**
   * T-250 — every warning about a `connect_inactive` hold is in-app, and the
   * photographer it concerns is by definition the one who has not finished
   * onboarding, so they are the least likely to be looking at a dashboard.
   */
  it('emails the photographer when their first sale is held for an inactive account', async () => {
    const { photographer } = await seedOrder({
      connectStatus: 'pending',
      connectAccountId: null,
      totalPriceCents: 500,
      paymentIntentId: 'pi_notify_first',
    });

    const res = await POST(
      paymentSucceededRequest({
        paymentIntentId: 'pi_notify_first',
        chargeId: 'ch_notify_first',
      }),
    );
    expect(res.status).toBe(200);

    const { sendHeldSaleEmail } = await import('@/lib/email/send-held-sale-email');
    expect(vi.mocked(sendHeldSaleEmail)).toHaveBeenCalledTimes(1);
    const [payload] = vi.mocked(sendHeldSaleEmail).mock.calls[0];
    // Resolved server-side from the id, via the existing service-role RPC.
    expect(payload.to).toBe(photographer.email);
    // 500 gross → 460 net on the Free plan; the same figure the dashboard quotes.
    expect(payload.heldAmount).toContain('4.60');
  });

  it('does not email again while the photographer is already in a holding streak', async () => {
    // The anti-spam rule: a photographer who sells 40 photos while
    // disconnected gets one email, not 40.
    const { sb, photographer } = await seedOrder({
      connectStatus: 'pending',
      connectAccountId: null,
      totalPriceCents: 500,
      paymentIntentId: 'pi_notify_streak_1',
    });

    expect(
      (
        await POST(
          paymentSucceededRequest({
            paymentIntentId: 'pi_notify_streak_1',
            chargeId: 'ch_notify_streak_1',
          }),
        )
      ).status,
    ).toBe(200);

    // A second, separate sale for the same photographer, still unable to be paid.
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);
    const talent = await createTestUser('TALENT');
    const { data: second } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status: 'pending',
        total_amount_cents: 500,
        currency: 'eur',
        stripe_payment_intent_id: 'pi_notify_streak_2',
      })
      .select('id')
      .single();
    if (!second) throw new Error('second order seed failed');
    await sb.from('order_items').insert({
      order_id: second.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: 500,
      total_price_cents: 500,
    });

    expect(
      (
        await POST(
          paymentSucceededRequest({
            paymentIntentId: 'pi_notify_streak_2',
            chargeId: 'ch_notify_streak_2',
          }),
        )
      ).status,
    ).toBe(200);

    // Two holds, one email.
    const { data: payouts } = await sb
      .from('payouts')
      .select('id')
      .eq('photographer_id', photographer.id)
      .eq('hold_reason', 'connect_inactive');
    expect(payouts).toHaveLength(2);

    const { sendHeldSaleEmail } = await import('@/lib/email/send-held-sale-email');
    expect(vi.mocked(sendHeldSaleEmail)).toHaveBeenCalledTimes(1);
  });

  it('keeps the 200 and the hold when the notice cannot be sent', async () => {
    // The buyer has already paid. A Resend failure must not become a 500, or
    // Stripe redelivers a money event.
    const { sendHeldSaleEmail } = await import('@/lib/email/send-held-sale-email');
    vi.mocked(sendHeldSaleEmail).mockRejectedValueOnce(new Error('Resend is down'));

    const { sb, photographer } = await seedOrder({
      connectStatus: 'pending',
      connectAccountId: null,
      totalPriceCents: 500,
      paymentIntentId: 'pi_notify_fails',
    });

    const res = await POST(
      paymentSucceededRequest({
        paymentIntentId: 'pi_notify_fails',
        chargeId: 'ch_notify_fails',
      }),
    );
    expect(res.status).toBe(200);

    const { data: payouts } = await sb
      .from('payouts')
      .select('status, hold_reason, amount_cents')
      .eq('photographer_id', photographer.id);
    expect(payouts).toHaveLength(1);
    expect(payouts?.[0]?.hold_reason).toBe('connect_inactive');
    expect(payouts?.[0]?.amount_cents).toBe(460);
  });

  it('does not email for a hold the photographer cannot clear', async () => {
    // `below_minimum` drains on its own once more sales accumulate — there is
    // nothing for them to do, so telling them would be noise.
    await seedOrder({
      connectStatus: 'active',
      connectAccountId: 'acct_test',
      totalPriceCents: 50,
      paymentIntentId: 'pi_notify_small',
    });

    expect(
      (
        await POST(
          paymentSucceededRequest({
            paymentIntentId: 'pi_notify_small',
            chargeId: 'ch_notify_small',
          }),
        )
      ).status,
    ).toBe(200);

    const { sendHeldSaleEmail } = await import('@/lib/email/send-held-sale-email');
    expect(vi.mocked(sendHeldSaleEmail)).not.toHaveBeenCalled();
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
    type: 'charge.dispute.created' | 'charge.dispute.updated' | 'charge.dispute.closed';
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
    const { sb, order, payout, photographer } = await seedCharge({
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

    // ⚠️ The row stays `pending`. Cancelling it here took the hold out of
    // `getTotalPendingPayouts` while the sale stayed in `net` (the order is still
    // `completed`, deliberately) — so opening an inquiry RAISED the photographer's
    // withdrawable balance by exactly the amount just frozen.
    const { data: duringPayout } = await sb
      .from('payouts')
      .select('status, frozen_by_dispute_id')
      .eq('id', payout.id)
      .single();
    expect(duringPayout?.status).toBe('pending');
    expect(duringPayout?.frozen_by_dispute_id).toBe('dp_ch_inquiry');

    // The balance does not move …
    expect(await getTotalPendingPayouts(sb, photographer.id)).toBe(460);
    // … and the frozen hold is still not payable, which is the point of freezing.
    const payable = await listPayableHolds(sb);
    expect(payable.map((row) => row.id)).not.toContain(payout.id);

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

  it('revokes access when an inquiry ESCALATES to a chargeback', async () => {
    // The escalation does not arrive as a new event: it is `charge.dispute.updated`
    // carrying a status that has left the `warning_*` family. Handling only
    // `created` left the buyer downloading for the whole chargeback — weeks —
    // because the inquiry branch leaves access alone by design and nothing
    // revisited it before `closed`.
    const { sb, order, payout, photographer } = await seedCharge({
      chargeId: 'ch_escalate',
      paymentIntentId: 'pi_escalate',
      amountCents: 500,
      payoutStatus: 'pending',
      payoutAmountCents: 460,
    });

    await stubStripeReads({
      chargeId: 'ch_escalate',
      amount: 500,
      disputes: [{ status: 'warning_needs_response', amount: 500 }],
    });
    expect(
      (
        await POST(
          disputeRequest({
            type: 'charge.dispute.created',
            chargeId: 'ch_escalate',
            paymentIntentId: 'pi_escalate',
            amountCents: 500,
            status: 'warning_needs_response',
          }),
        )
      ).status,
    ).toBe(200);

    const { data: asInquiry } = await sb
      .from('orders')
      .select('status')
      .eq('id', order.id)
      .single();
    expect(asInquiry?.status).toBe('completed');

    // The bank escalates: same dispute, real chargeback now.
    await stubStripeReads({
      chargeId: 'ch_escalate',
      amount: 500,
      disputes: [{ status: 'needs_response', amount: 500 }],
    });
    expect(
      (
        await POST(
          disputeRequest({
            type: 'charge.dispute.updated',
            chargeId: 'ch_escalate',
            paymentIntentId: 'pi_escalate',
            amountCents: 500,
            status: 'needs_response',
          }),
        )
      ).status,
    ).toBe(200);

    const { data: escalated } = await sb
      .from('orders')
      .select('status')
      .eq('id', order.id)
      .single();
    expect(escalated?.status).toBe('disputed');

    // And the money follows access out: the sale has left `net`, so the hold has to
    // leave `pending` with it or the same money is subtracted twice.
    const { data: heldRow } = await sb
      .from('payouts')
      .select('status, frozen_by_dispute_id')
      .eq('id', payout.id)
      .single();
    expect(heldRow?.status).toBe('cancelled');
    expect(heldRow?.frozen_by_dispute_id).toBe('dp_ch_escalate');
    expect(await getTotalPendingPayouts(sb, photographer.id)).toBe(0);
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

  it('KEEPS a lost chargeback revoked even when the dispute listing fails', async () => {
    // `fetchDisputeFacts` swallows a Stripe read error into "no disputes", and a
    // lost chargeback carries no refund — so all three facts read false,
    // `resolveOrderStatus` computes `completed`, and the buyer who just won a
    // chargeback gets their access back permanently, after we already reversed the
    // money and paid the fee. The event itself is authoritative and must win.
    const { sb, order } = await seedCharge({
      chargeId: 'ch_lost_blind',
      paymentIntentId: 'pi_lost_blind',
      amountCents: 2000,
      payoutStatus: 'paid',
      payoutAmountCents: 1840,
    });

    await stubStripeReads({
      chargeId: 'ch_lost_blind',
      amount: 2000,
      disputes: [{ status: 'needs_response', amount: 2000 }],
    });
    await POST(
      disputeRequest({
        type: 'charge.dispute.created',
        chargeId: 'ch_lost_blind',
        paymentIntentId: 'pi_lost_blind',
        amountCents: 2000,
        status: 'needs_response',
      }),
    );
    expect(
      (await sb.from('orders').select('status').eq('id', order.id).single()).data?.status,
    ).toBe('disputed');

    // The charge still reads, but listing the disputes blows up.
    const { stripe: stripeClient } = await import('@/lib/stripe/config');
    vi.spyOn(stripeClient.disputes, 'list').mockRejectedValue(
      new Error('stripe is having a moment'),
    );

    expect(
      (
        await POST(
          disputeRequest({
            type: 'charge.dispute.closed',
            chargeId: 'ch_lost_blind',
            paymentIntentId: 'pi_lost_blind',
            amountCents: 2000,
            status: 'lost',
          }),
        )
      ).status,
    ).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('disputed');
  });

  it('never promotes an order that was never completed', async () => {
    // `completed` is a COMPUTED result here and `completed` IS access. A partial
    // refund deliberately resolves to `completed` (it must not revoke), so writing
    // it unguarded hands the photos to an order stuck `pending` because its
    // `payment_intent.succeeded` was lost — someone who never paid.
    const { sb, order } = await seedCharge({
      chargeId: 'ch_never_paid',
      paymentIntentId: 'pi_never_paid',
      amountCents: 2000,
      payoutStatus: 'pending',
      payoutAmountCents: 1840,
    });
    await sb.from('orders').update({ status: 'pending' }).eq('id', order.id);

    await stubStripeReads({ chargeId: 'ch_never_paid', amount: 2000, amountRefunded: 500 });
    expect(
      (
        await POST(
          refundRequest({
            chargeId: 'ch_never_paid',
            paymentIntentId: 'pi_never_paid',
            amountCents: 2000,
            refundedCents: 500,
          }),
        )
      ).status,
    ).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('pending');
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

/**
 * T-252 — Stripe does not guarantee the order in which it delivers events, and
 * until this ticket only `payment_intent.succeeded` created transfers. Delivered
 * first, it found no order (the session event had not created one yet), skipped
 * the whole block and returned 200; the order then arrived already `completed`
 * and nobody ever transferred — buyer charged, photographer unpaid, zero
 * `payouts` rows, not one log line. These tests pin the property that matters:
 * **both delivery orders converge on the same final state**, and neither pays
 * twice.
 */
describe('app/api/stripe/webhook — out-of-order delivery (T-252)', () => {
  let restoreRetrieve: (() => void) | null = null;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    restoreRetrieve = null;
  });

  afterEach(() => {
    restoreRetrieve?.();
    restoreRetrieve = null;
  });

  /** One connected photographer, one photo, one talent cart holding it. */
  async function seedCart() {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_t252', stripe_connect_status: 'active' })
      .eq('id', photographer.id);
    const event = await createTestEvent(photographer.id, { price_per_photo: 5 });
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

    return { sb, photographer, talent, cart };
  }

  /** The session payload carries no charge, so the handler retrieves the PI. */
  async function stubChargeLookup(paymentIntentId: string, chargeId: string) {
    const { stripe: routeStripe } = await import('@/lib/stripe/config');
    const spy = vi.spyOn(routeStripe.paymentIntents, 'retrieve').mockResolvedValue({
      id: paymentIntentId,
      object: 'payment_intent',
      latest_charge: chargeId,
    } as never);
    restoreRetrieve = () => spy.mockRestore();
  }

  function sessionCompletedRequest(opts: {
    sessionId: string;
    cartId: string;
    userId: string;
    paymentIntentId: string;
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
          payment_status: 'paid',
          client_reference_id: opts.cartId,
          payment_intent: opts.paymentIntentId,
          amount_total: 500,
          currency: 'eur',
          metadata: { user_id: opts.userId, cart_id: opts.cartId },
        },
      },
    });
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

  it('pays the photographer when payment_intent.succeeded is delivered FIRST', async () => {
    const { sb, photographer, talent, cart } = await seedCart();
    await stubChargeLookup('pi_t252_out', 'ch_t252_out');

    const { createTransfer } = await import('@/lib/stripe/connect');
    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');

    // 1. The payment lands before the session. There is no order to find yet.
    expect(
      (
        await POST(
          paymentSucceededRequest({
            paymentIntentId: 'pi_t252_out',
            chargeId: 'ch_t252_out',
          }),
        )
      ).status,
    ).toBe(200);

    const { data: earlyPayouts } = await sb
      .from('payouts')
      .select('id')
      .eq('photographer_id', photographer.id);
    expect(earlyPayouts).toHaveLength(0);
    expect(vi.mocked(createTransfer)).not.toHaveBeenCalled();

    // A payment intent with no order is ORDINARY (subscriptions, guest orders),
    // so it must stay quiet — an alert here would bury the real ones.
    expect(vi.mocked(reportMoneyIncident)).not.toHaveBeenCalled();

    // 2. The session arrives second and must pay. Before T-252 it created the
    //    order and stopped, and nobody ever transferred.
    expect(
      (
        await POST(
          sessionCompletedRequest({
            sessionId: 'cs_t252_out',
            cartId: cart.id,
            userId: talent.id,
            paymentIntentId: 'pi_t252_out',
          }),
        )
      ).status,
    ).toBe(200);

    const { data: order } = await sb
      .from('orders')
      .select('id, status')
      .eq('stripe_checkout_session_id', 'cs_t252_out')
      .single();
    expect(order?.status).toBe('completed');

    const { data: payouts } = await sb
      .from('payouts')
      .select('status, amount_cents, stripe_charge_id, hold_reason, order_id, order_kind')
      .eq('photographer_id', photographer.id);

    expect(payouts).toHaveLength(1);
    expect(payouts?.[0]?.status).toBe('paid');
    expect(payouts?.[0]?.amount_cents).toBe(460); // 500 gross − 8% Free commission
    expect(payouts?.[0]?.stripe_charge_id).toBe('ch_t252_out');
    expect(payouts?.[0]?.hold_reason).toBeNull();
    expect(payouts?.[0]?.order_id).toBe(order?.id);
    expect(payouts?.[0]?.order_kind).toBe('order');
    expect(vi.mocked(createTransfer)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportMoneyIncident)).not.toHaveBeenCalled();
  });

  it('converges on the identical state when the two events arrive in order', async () => {
    const { sb, photographer, talent, cart } = await seedCart();
    await stubChargeLookup('pi_t252_in', 'ch_t252_in');

    const { createTransfer } = await import('@/lib/stripe/connect');
    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');

    expect(
      (
        await POST(
          sessionCompletedRequest({
            sessionId: 'cs_t252_in',
            cartId: cart.id,
            userId: talent.id,
            paymentIntentId: 'pi_t252_in',
          }),
        )
      ).status,
    ).toBe(200);

    // The payment event follows and finds the money already sent. It must not
    // send it again — `openPayoutRow` hands it a null on the unique index.
    expect(
      (
        await POST(
          paymentSucceededRequest({ paymentIntentId: 'pi_t252_in', chargeId: 'ch_t252_in' }),
        )
      ).status,
    ).toBe(200);

    const { data: order } = await sb
      .from('orders')
      .select('id, status')
      .eq('stripe_checkout_session_id', 'cs_t252_in')
      .single();
    expect(order?.status).toBe('completed');

    const { data: payouts } = await sb
      .from('payouts')
      .select('status, amount_cents, stripe_charge_id, hold_reason, order_id, order_kind')
      .eq('photographer_id', photographer.id);

    // Identical to the out-of-order run above — that equality IS the fix.
    expect(payouts).toHaveLength(1);
    expect(payouts?.[0]?.status).toBe('paid');
    expect(payouts?.[0]?.amount_cents).toBe(460);
    expect(payouts?.[0]?.stripe_charge_id).toBe('ch_t252_in');
    expect(payouts?.[0]?.hold_reason).toBeNull();
    expect(payouts?.[0]?.order_id).toBe(order?.id);
    expect(payouts?.[0]?.order_kind).toBe('order');
    expect(vi.mocked(createTransfer)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportMoneyIncident)).not.toHaveBeenCalled();
  });

  it('does not re-enter the money path when checkout.session.completed is redelivered', async () => {
    // ⚠️ The redelivery must stop at the already-exists guard and touch NOTHING
    // — not the transfers, not the email, not the cart. Re-driving the payouts
    // here looks free (`openPayoutRow` would hand the second writer a null) but
    // the index backing that guard is partial on `stripe_charge_id is not null`,
    // and every row written before T-216 has a null charge id: a resent old
    // session would open a fresh row under a new idempotency key and pay twice.
    const { sb, photographer, talent, cart } = await seedCart();
    await stubChargeLookup('pi_t252_dup', 'ch_t252_dup');

    const { sendPurchaseConfirmationEmail } = await import(
      '@/lib/email/send-purchase-confirmation-email'
    );
    const { stripe: routeStripe } = await import('@/lib/stripe/config');
    const { createTransfer } = await import('@/lib/stripe/connect');

    const build = () =>
      sessionCompletedRequest({
        sessionId: 'cs_t252_dup',
        cartId: cart.id,
        userId: talent.id,
        paymentIntentId: 'pi_t252_dup',
      });

    expect((await POST(build())).status).toBe(200);

    const callsAfterFirst = {
      transfer: vi.mocked(createTransfer).mock.calls.length,
      email: vi.mocked(sendPurchaseConfirmationEmail).mock.calls.length,
      retrieve: vi.mocked(routeStripe.paymentIntents.retrieve).mock.calls.length,
    };

    expect((await POST(build())).status).toBe(200);

    // Nothing ran a second time — including the live Stripe read the drive needs,
    // which is the cheapest proof the redelivery never entered the money path.
    expect(vi.mocked(createTransfer)).toHaveBeenCalledTimes(callsAfterFirst.transfer);
    expect(vi.mocked(sendPurchaseConfirmationEmail)).toHaveBeenCalledTimes(callsAfterFirst.email);
    expect(vi.mocked(routeStripe.paymentIntents.retrieve)).toHaveBeenCalledTimes(
      callsAfterFirst.retrieve,
    );

    const { count: orderCount } = await sb
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('stripe_checkout_session_id', 'cs_t252_dup');
    expect(orderCount).toBe(1);

    const { data: payouts } = await sb
      .from('payouts')
      .select('status')
      .eq('photographer_id', photographer.id);
    expect(payouts).toHaveLength(1);
  });

  it('leaves the transfers to payment_intent.succeeded while the session is unpaid', async () => {
    const { sb, photographer, talent, cart } = await seedCart();

    // A delayed payment method completes the session with `payment_status:
    // 'unpaid'`. There is no money to split yet, and this is not silence: the
    // payment event drives the transfers once the funds settle.
    const req = signedWebhookRequest({
      id: 'evt_cs_t252_unpaid',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cs_t252_unpaid',
          object: 'checkout.session',
          mode: 'payment',
          payment_status: 'unpaid',
          client_reference_id: cart.id,
          payment_intent: 'pi_t252_unpaid',
          amount_total: 500,
          currency: 'eur',
          metadata: { user_id: talent.id, cart_id: cart.id },
        },
      },
    });
    expect((await POST(req)).status).toBe(200);

    const { createTransfer } = await import('@/lib/stripe/connect');
    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(createTransfer)).not.toHaveBeenCalled();
    expect(vi.mocked(reportMoneyIncident)).not.toHaveBeenCalled();

    const { data: payouts } = await sb
      .from('payouts')
      .select('id')
      .eq('photographer_id', photographer.id);
    expect(payouts).toHaveLength(0);

    // …and it does land once the payment settles.
    expect(
      (
        await POST(
          paymentSucceededRequest({
            paymentIntentId: 'pi_t252_unpaid',
            chargeId: 'ch_t252_unpaid',
          }),
        )
      ).status,
    ).toBe(200);

    const { data: settled } = await sb
      .from('payouts')
      .select('status, amount_cents')
      .eq('photographer_id', photographer.id);
    expect(settled).toHaveLength(1);
    expect(settled?.[0]?.status).toBe('paid');
    expect(settled?.[0]?.amount_cents).toBe(460);
  });
});

/**
 * T-259 — a reversed sale must not be resurrected by a late payment event.
 *
 * `payment_intent.succeeded` promoted any order that merely happened not to be
 * `completed`. Stripe redelivers for up to three days and a dashboard resend is
 * routine here (T-192), so a refund landing between the original delivery and
 * its retry left the retry flipping the order back to `completed` — restoring
 * permanent ZIP and library access for a buyer who had been refunded, and
 * putting the sale back in the photographer's `net` while its payout row sat
 * `cancelled`.
 *
 * The money was never at risk (the exactly-once index blocks the re-drive);
 * access was.
 */
describe('app/api/stripe/webhook — a late payment event cannot resurrect a reversal (T-259)', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  async function seedOrderWithStatus(status: string, paymentIntentId: string) {
    const sb = createServiceClient();
    const talent = await createTestUser('TALENT');
    const { data: order } = await sb
      .from('orders')
      .insert({
        user_id: talent.id,
        status,
        total_amount_cents: 500,
        currency: 'eur',
        stripe_payment_intent_id: paymentIntentId,
      })
      .select('id')
      .single();
    if (!order) throw new Error('order seed failed');
    return { sb, order };
  }

  function succeeded(paymentIntentId: string, chargeId: string) {
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

  it('leaves a REFUNDED order refunded', async () => {
    const { sb, order } = await seedOrderWithStatus('refunded', 'pi_t259_refunded');

    expect((await POST(succeeded('pi_t259_refunded', 'ch_t259_refunded'))).status).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('refunded');
  });

  it('leaves a DISPUTED order disputed', async () => {
    const { sb, order } = await seedOrderWithStatus('disputed', 'pi_t259_disputed');

    expect((await POST(succeeded('pi_t259_disputed', 'ch_t259_disputed'))).status).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('disputed');
  });

  it('still promotes an ordinary PENDING order — the guard must not break the happy path', async () => {
    const { sb, order } = await seedOrderWithStatus('pending', 'pi_t259_pending');

    expect((await POST(succeeded('pi_t259_pending', 'ch_t259_pending'))).status).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('completed');
  });

  it('still promotes a FAILED order — a retried payment that finally succeeds', async () => {
    const { sb, order } = await seedOrderWithStatus('failed', 'pi_t259_failed');

    expect((await POST(succeeded('pi_t259_failed', 'ch_t259_failed'))).status).toBe(200);

    const { data: after } = await sb.from('orders').select('status').eq('id', order.id).single();
    expect(after?.status).toBe('completed');
  });
});

/**
 * T-261 — a paid guest order must never end up silently undeliverable.
 *
 * `createGuestOrder` wrote the row `completed` before its items and download
 * token existed, and both of those writes throw. A throw became a 500, Stripe
 * redelivered, and the redelivery hit the "guest order already exists" guard and
 * returned early — so the transfer block ran on NEITHER delivery. The result was
 * a `guest_orders` row marked `completed` with the buyer charged, no items, no
 * token, no `payouts` row, and not one log line.
 *
 * The failure class is not hypothetical: T-239 was a PostgREST schema-cache error
 * on `order_items`, and `guest_order_items` / `download_tokens` are equally
 * exposed.
 *
 * Two properties are pinned here: the failure REPORTS, and the row stays
 * `pending` so a redelivery can finish it.
 */
describe('app/api/stripe/webhook — a guest order that cannot be assembled (T-261)', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  async function seedGuestPhoto(suffix: string) {
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await sb
      .from('profiles')
      .update({ stripe_connect_account_id: `acct_${suffix}`, stripe_connect_status: 'active' })
      .eq('id', photographer.id);
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id);

    const { stripe: routeStripe } = await import('@/lib/stripe/config');
    vi.spyOn(routeStripe.paymentIntents, 'retrieve').mockResolvedValue({
      id: `pi_${suffix}`,
      object: 'payment_intent',
      latest_charge: `ch_${suffix}`,
    } as never);

    return { sb, photographer, photo };
  }

  function guestSession(suffix: string, photoId: string, photographerId: string) {
    return signedWebhookRequest({
      id: `evt_${suffix}`,
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `cs_${suffix}`,
          object: 'checkout.session',
          mode: 'payment',
          customer: null,
          customer_details: { email: `${suffix}@photomarkt.test` },
          payment_intent: `pi_${suffix}`,
          amount_total: 500,
          currency: 'eur',
          metadata: {
            is_guest: 'true',
            cart_count: '1',
            cart_0: JSON.stringify({ p: photoId, g: photographerId, c: 500 }),
          },
        },
      },
    });
  }

  it('reports an incident and leaves the order pending when the download token cannot be written', async () => {
    const { sb, photographer, photo } = await seedGuestPhoto('t261_fail');

    const tokens = await import('@/database/queries/download-tokens');
    const tokenSpy = vi
      .spyOn(tokens, 'createDownloadToken')
      .mockRejectedValueOnce(new Error('PGRST205: schema cache miss on download_tokens'));

    await expect(POST(guestSession('t261_fail', photo.id, photographer.id))).resolves.toBeDefined();

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(reportMoneyIncident)).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'payout-not-recorded' }),
    );

    // The incident carries ids and amounts only — never the buyer's email.
    const reported = vi.mocked(reportMoneyIncident).mock.calls[0]?.[0];
    expect(JSON.stringify(reported?.context)).not.toContain('@photomarkt.test');

    // And the row is left resumable, not falsely marked delivered.
    const { data: order } = await sb
      .from('guest_orders')
      .select('status')
      .eq('stripe_checkout_session_id', 'cs_t261_fail')
      .single();
    expect(order?.status).toBe('pending');

    tokenSpy.mockRestore();
  });

  it('a redelivery finishes a half-written order instead of returning early', async () => {
    const { sb, photographer, photo } = await seedGuestPhoto('t261_resume');

    const tokens = await import('@/database/queries/download-tokens');
    const tokenSpy = vi
      .spyOn(tokens, 'createDownloadToken')
      .mockRejectedValueOnce(new Error('transient'));

    // First delivery fails part-way.
    await expect(
      POST(guestSession('t261_resume', photo.id, photographer.id)),
    ).resolves.toBeDefined();
    tokenSpy.mockRestore();

    // Stripe redelivers; this one must complete the order rather than break.
    expect((await POST(guestSession('t261_resume', photo.id, photographer.id))).status).toBe(200);

    const { data: order } = await sb
      .from('guest_orders')
      .select('id, status')
      .eq('stripe_checkout_session_id', 'cs_t261_resume')
      .single();
    expect(order?.status).toBe('completed');

    // Exactly one order, and its items written exactly once — the resume must not
    // duplicate what the first delivery managed to write.
    const { count: orderCount } = await sb
      .from('guest_orders')
      .select('*', { count: 'exact', head: true })
      .eq('stripe_checkout_session_id', 'cs_t261_resume');
    expect(orderCount).toBe(1);

    const { count: itemCount } = await sb
      .from('guest_order_items')
      .select('*', { count: 'exact', head: true })
      .eq('guest_order_id', order?.id ?? '');
    expect(itemCount).toBe(1);

    // And the photographer is finally paid — the whole point.
    const { data: payouts } = await sb
      .from('payouts')
      .select('id')
      .eq('photographer_id', photographer.id);
    expect((payouts ?? []).length).toBeGreaterThan(0);
  });
});
