/**
 * Regression tests for `createBillingCheckoutAction`
 * (`src/app/[lang]/dashboard/photographer/billing/actions.ts`).
 *
 * Guard: a Stripe failure (expired/invalid API key, network, misconfig) on the
 * "no active subscription → create customer + checkout session" path must NOT
 * propagate the raw Stripe error out of the Server Action. Before the fix that
 * path had no try/catch, so an `Expired API Key` error escaped, Next redacted it
 * in prod, and the photographer saw the opaque "Server Components render"
 * message. The action must instead surface a clean `checkout_failed` domain
 * error that call sites map to a translated toast.
 *
 * All external deps (Stripe SDK, Supabase client, subscription query) are mocked
 * so this runs as a fast unit test with no DB.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stripeMock, supabaseMock, adminMock, getSubscriptionMock, getCurrentPlanMock } = vi.hoisted(
  () => ({
    stripeMock: {
      customers: { create: vi.fn() },
      checkout: { sessions: { create: vi.fn() } },
      subscriptions: { retrieve: vi.fn(), update: vi.fn() },
    },
    supabaseMock: {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
    },
    // `subscriptions` is a system-managed table (RLS on, no policies) so the
    // action MUST read/insert it via the service-role client, not the
    // user-scoped one. This mock stands in for `supabaseAdmin`.
    adminMock: {
      from: vi.fn(),
    },
    getSubscriptionMock: vi.fn(),
    getCurrentPlanMock: vi.fn(),
  }),
);

vi.mock('@/lib/stripe/config', () => ({ stripe: stripeMock }));

vi.mock('@/database/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}));

vi.mock('@/database/supabase-admin', () => ({ supabaseAdmin: adminMock }));

vi.mock('@/database/queries/subscriptions', () => ({
  getSubscription: (...args: unknown[]) => getSubscriptionMock(...args),
  getCurrentPlan: (...args: unknown[]) => getCurrentPlanMock(...args),
}));

// Monthly prices configured; PRO yearly deliberately left empty so the yearly
// path exercises the `yearly_unavailable` branch (documented optional env).
vi.mock('@/env.mjs', () => ({
  env: {
    STRIPE_PRICE_AMATEUR: 'price_test_amateur',
    STRIPE_PRICE_PRO: 'price_test_pro',
    STRIPE_PRICE_AMATEUR_YEARLY: 'price_test_amateur_yearly',
    STRIPE_PRICE_PRO_YEARLY: '',
    SITE_URL: 'http://127.0.0.1:3000',
  },
}));

import { createBillingCheckoutAction } from '@/app/[lang]/dashboard/photographer/billing/actions';

// Mirror the real Stripe error the ticket reports.
const RAW_STRIPE_MESSAGE = 'Expired API Key provided: sk_test_***cFgYOv';

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'photographer@example.com' } },
    error: null,
  });
  // Default: the service-role client accepts the subscription insert. The
  // user-scoped client is deliberately given a throwing `from` so any attempt
  // to touch `subscriptions` through it fails the test loudly (regression:
  // subscription writes must never go through the RLS-blocked user client).
  adminMock.from.mockReturnValue({ insert: vi.fn(async () => ({ data: null, error: null })) });
  supabaseMock.from.mockImplementation(() => {
    throw new Error('subscriptions must be written via supabaseAdmin, not the user-scoped client');
  });
});

describe('createBillingCheckoutAction — Stripe failure handling', () => {
  it('returns a clean domain error (not the raw Stripe message) when customer creation fails', async () => {
    getSubscriptionMock.mockResolvedValue(null); // no existing subscription → create path
    stripeMock.customers.create.mockRejectedValue(new Error(RAW_STRIPE_MESSAGE));

    const result = await createBillingCheckoutAction('starter');

    // A controlled code is returned — the raw Stripe message never leaks out.
    expect(result).toEqual({ error: 'checkout_failed' });
    expect(JSON.stringify(result)).not.toContain('Expired API Key');
  });

  it('returns a clean domain error when checkout session creation fails', async () => {
    getSubscriptionMock.mockResolvedValue({ stripe_customer_id: 'cus_123' });
    stripeMock.checkout.sessions.create.mockRejectedValue(new Error(RAW_STRIPE_MESSAGE));

    await expect(createBillingCheckoutAction('starter')).resolves.toEqual({
      error: 'checkout_failed',
    });
  });

  it('returns a clean domain error when updating an existing subscription fails', async () => {
    getSubscriptionMock.mockResolvedValue({
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_123',
      status: 'active',
    });
    stripeMock.subscriptions.retrieve.mockRejectedValue(new Error(RAW_STRIPE_MESSAGE));

    await expect(createBillingCheckoutAction('pro')).resolves.toEqual({ error: 'checkout_failed' });
  });

  it('returns checkout_failed when the local subscription insert fails (no orphaned customer left unreported)', async () => {
    getSubscriptionMock.mockResolvedValue(null); // create path → inserts a row
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_new' });
    // Supabase returns { error } instead of throwing.
    adminMock.from.mockReturnValue({
      insert: vi.fn(async () => ({ data: null, error: { message: 'insert failed' } })),
    });

    await expect(createBillingCheckoutAction('starter')).resolves.toEqual({
      error: 'checkout_failed',
    });
    // Must not proceed to create a checkout session after the insert failed.
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('inserts the subscription row via the service-role client, never the user-scoped one (RLS regression)', async () => {
    getSubscriptionMock.mockResolvedValue(null); // create path → inserts a row
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_new' });
    const adminInsert = vi.fn(async () => ({ data: null, error: null }));
    adminMock.from.mockReturnValue({ insert: adminInsert });
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/x' });

    await expect(createBillingCheckoutAction('starter')).resolves.toEqual({
      url: 'https://checkout.stripe.com/x',
    });

    // The insert went through supabaseAdmin (service role) — the previous
    // user-scoped insert failed with 42501 under RLS. The user client's `from`
    // throws in beforeEach, so reaching here proves it was never used.
    expect(adminMock.from).toHaveBeenCalledWith('subscriptions');
    expect(adminInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', plan_id: 'starter', status: 'incomplete' }),
    );
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('returns yearly_unavailable (a distinct, actionable code) when the yearly price env is missing', async () => {
    getSubscriptionMock.mockResolvedValue(null);

    await expect(createBillingCheckoutAction('pro', 'yearly')).resolves.toEqual({
      error: 'yearly_unavailable',
    });
    // Never touches Stripe when the price isn't configured.
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('returns the checkout url on the happy path', async () => {
    getSubscriptionMock.mockResolvedValue({ stripe_customer_id: 'cus_123' });
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/x' });

    await expect(createBillingCheckoutAction('starter')).resolves.toEqual({
      url: 'https://checkout.stripe.com/x',
    });
  });
});

describe('createBillingCheckoutAction — plan change clears a pending cancellation (T-214)', () => {
  it('sends cancel_at_period_end: false with the in-place plan change', async () => {
    // A photographer who cancelled and then picked another paid plan. Without
    // clearing the flag they'd land on the newly chosen plan already scheduled
    // to end — a cancellation inherited from the plan they just left.
    getSubscriptionMock.mockResolvedValue({
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_123',
      status: 'active',
      cancel_at_period_end: true,
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_123',
      items: { data: [{ id: 'si_123' }] },
    });
    stripeMock.subscriptions.update.mockResolvedValue({ id: 'sub_123' });

    await expect(createBillingCheckoutAction('pro')).resolves.toEqual({ updated: true });

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({ cancel_at_period_end: false }),
    );
    // The new price still goes out — clearing the flag must not replace the
    // actual plan change.
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({ items: [{ id: 'si_123', price: 'price_test_pro' }] }),
    );
  });

  it('sends it unconditionally, so an uncancelled subscription is unaffected', async () => {
    getSubscriptionMock.mockResolvedValue({
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_123',
      status: 'active',
      cancel_at_period_end: false,
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_123',
      items: { data: [{ id: 'si_123' }] },
    });
    stripeMock.subscriptions.update.mockResolvedValue({ id: 'sub_123' });

    await createBillingCheckoutAction('starter');

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({ cancel_at_period_end: false }),
    );
  });

  it('still writes nothing to subscriptions — the webhook applies the change', async () => {
    getSubscriptionMock.mockResolvedValue({
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_123',
      status: 'active',
      cancel_at_period_end: true,
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_123',
      items: { data: [{ id: 'si_123' }] },
    });
    stripeMock.subscriptions.update.mockResolvedValue({ id: 'sub_123' });

    await createBillingCheckoutAction('pro');

    expect(adminMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});
