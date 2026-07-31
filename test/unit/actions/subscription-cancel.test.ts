/**
 * Unit tests for `cancelSubscriptionAction` / `reactivateSubscriptionAction` (T-214).
 *
 * The load-bearing guarantee here is the one the ticket asks to be pinned:
 * **the actions never write to `subscriptions`.** Stripe is the source of truth
 * and the `customer.subscription.*` webhook is the sole writer, so an action
 * that anticipated the state locally could leave the DB asserting a
 * cancellation Stripe doesn't have (successful call, lost webhook) or the
 * reverse (local write, failed call).
 *
 * Both Supabase clients are therefore given a `from` that throws: reaching the
 * end of a test proves neither was used to touch a table. The subscription read
 * goes through the mocked `getSubscription`, which is where the service-role
 * elevation lives.
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
    adminMock: { from: vi.fn() },
    getSubscriptionMock: vi.fn(),
    getCurrentPlanMock: vi.fn(),
  }),
);

vi.mock('@/lib/stripe/config', () => ({ stripe: stripeMock }));
vi.mock('@/database/server', () => ({ createClient: vi.fn(async () => supabaseMock) }));
vi.mock('@/database/supabase-admin', () => ({ supabaseAdmin: adminMock }));
vi.mock('@/database/queries/subscriptions', () => ({
  getSubscription: (...args: unknown[]) => getSubscriptionMock(...args),
  getCurrentPlan: (...args: unknown[]) => getCurrentPlanMock(...args),
}));
vi.mock('@/env.mjs', () => ({
  env: {
    STRIPE_PRICE_AMATEUR: 'price_test_amateur',
    STRIPE_PRICE_PRO: 'price_test_pro',
    STRIPE_PRICE_AMATEUR_YEARLY: 'price_test_amateur_yearly',
    STRIPE_PRICE_PRO_YEARLY: 'price_test_pro_yearly',
    SITE_URL: 'http://127.0.0.1:3000',
  },
}));

import {
  cancelSubscriptionAction,
  reactivateSubscriptionAction,
} from '@/app/[lang]/dashboard/photographer/billing/actions';

const PERIOD_END = 1_924_992_000; // 2031-01-01T00:00:00Z
const PERIOD_END_ISO = '2031-01-01T00:00:00.000Z';

/** A live subscription as `getSubscription` would return it. */
function activeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    user_id: 'user-1',
    stripe_customer_id: 'cus_123',
    stripe_subscription_id: 'sub_123',
    plan_id: 'pro',
    status: 'active',
    current_period_end: PERIOD_END_ISO,
    cancel_at_period_end: false,
    ...overrides,
  };
}

/** What Stripe echoes back from `subscriptions.update`. */
function stripeSubscription(cancelAtPeriodEnd: boolean) {
  return {
    id: 'sub_123',
    cancel_at_period_end: cancelAtPeriodEnd,
    items: { data: [{ price: { id: 'price_test_pro' }, current_period_end: PERIOD_END }] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'photographer@example.com' } },
    error: null,
  });
  // Neither client may be used to touch a table. If either `from` is called the
  // test fails loudly — this is the "the action must not write" assertion.
  const forbid = (client: string) => () => {
    throw new Error(`${client}.from() was called — the cancel/reactivate actions must not write`);
  };
  supabaseMock.from.mockImplementation(forbid('user-scoped client'));
  adminMock.from.mockImplementation(forbid('supabaseAdmin'));
});

describe('cancelSubscriptionAction', () => {
  it('sets cancel_at_period_end in Stripe and writes nothing locally', async () => {
    getSubscriptionMock.mockResolvedValue(activeSubscription());
    stripeMock.subscriptions.update.mockResolvedValue(stripeSubscription(true));

    const result = await cancelSubscriptionAction();

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: true,
    });
    // No immediate termination: `cancel` / `cancel_at` / a delete are never used.
    expect(stripeMock.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, currentPeriodEnd: PERIOD_END_ISO });

    // The DB was never touched — the webhook owns the state change.
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(adminMock.from).not.toHaveBeenCalled();
  });

  it('reports the real period end from the STRIPE response, not the stored row', async () => {
    // Row is stale on purpose; the action must relay what Stripe just said.
    getSubscriptionMock.mockResolvedValue(
      activeSubscription({ current_period_end: '2020-01-01T00:00:00.000Z' }),
    );
    stripeMock.subscriptions.update.mockResolvedValue(stripeSubscription(true));

    await expect(cancelSubscriptionAction()).resolves.toEqual({
      ok: true,
      currentPeriodEnd: PERIOD_END_ISO,
    });
  });

  it('refuses a second cancellation without calling Stripe', async () => {
    getSubscriptionMock.mockResolvedValue(activeSubscription({ cancel_at_period_end: true }));

    await expect(cancelSubscriptionAction()).resolves.toEqual({ error: 'already_cancelled' });
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns no_subscription when there is no row at all', async () => {
    getSubscriptionMock.mockResolvedValue(null);

    await expect(cancelSubscriptionAction()).resolves.toEqual({ error: 'no_subscription' });
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns no_subscription when the row has no Stripe subscription id', async () => {
    getSubscriptionMock.mockResolvedValue(
      activeSubscription({ stripe_subscription_id: null, status: 'incomplete' }),
    );

    await expect(cancelSubscriptionAction()).resolves.toEqual({ error: 'no_subscription' });
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns no_subscription for an already-canceled subscription', async () => {
    getSubscriptionMock.mockResolvedValue(activeSubscription({ status: 'canceled' }));

    await expect(cancelSubscriptionAction()).resolves.toEqual({ error: 'no_subscription' });
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns a translatable code (never the raw Stripe message) when Stripe fails', async () => {
    getSubscriptionMock.mockResolvedValue(activeSubscription());
    stripeMock.subscriptions.update.mockRejectedValue(
      new Error('Expired API Key provided: sk_test_***cFgYOv'),
    );

    const result = await cancelSubscriptionAction();

    expect(result).toEqual({ error: 'subscription_failed' });
    expect(JSON.stringify(result)).not.toContain('Expired API Key');
  });

  it('returns subscription_missing when Stripe no longer has the subscription', async () => {
    // A stale row (subscription deleted in Stripe, wiped test data, an old
    // dump) answers `resource_missing` forever. Reporting the generic failure
    // told the photographer to "try again in a moment" for something that can
    // never succeed, leaving them stuck on a paid plan with no way out.
    getSubscriptionMock.mockResolvedValue(activeSubscription());
    stripeMock.subscriptions.update.mockRejectedValue(
      Object.assign(new Error("No such subscription: 'sub_123'"), {
        code: 'resource_missing',
        statusCode: 404,
      }),
    );

    await expect(cancelSubscriptionAction()).resolves.toEqual({
      error: 'subscription_missing',
    });
  });

  it('throws for an unauthenticated caller without touching Stripe or the DB', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(cancelSubscriptionAction()).rejects.toThrow('Unauthorized');
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(adminMock.from).not.toHaveBeenCalled();
  });

  it('can cancel a trialing or past_due subscription', async () => {
    for (const status of ['trialing', 'past_due']) {
      vi.clearAllMocks();
      getSubscriptionMock.mockResolvedValue(activeSubscription({ status }));
      stripeMock.subscriptions.update.mockResolvedValue(stripeSubscription(true));

      await expect(cancelSubscriptionAction()).resolves.toEqual({
        ok: true,
        currentPeriodEnd: PERIOD_END_ISO,
      });
    }
  });
});

describe('reactivateSubscriptionAction', () => {
  it('clears cancel_at_period_end in Stripe and writes nothing locally', async () => {
    getSubscriptionMock.mockResolvedValue(activeSubscription({ cancel_at_period_end: true }));
    stripeMock.subscriptions.update.mockResolvedValue(stripeSubscription(false));

    const result = await reactivateSubscriptionAction();

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: false,
    });
    expect(result).toEqual({ ok: true, currentPeriodEnd: PERIOD_END_ISO });
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(adminMock.from).not.toHaveBeenCalled();
  });

  it('leaves the plan and period untouched — no new charge is requested', async () => {
    getSubscriptionMock.mockResolvedValue(activeSubscription({ cancel_at_period_end: true }));
    stripeMock.subscriptions.update.mockResolvedValue(stripeSubscription(false));

    await reactivateSubscriptionAction();

    // Only the flag is sent: no `items`, no `proration_behavior`, no price.
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: false,
    });
  });

  it('returns not_cancelled when there was nothing pending', async () => {
    getSubscriptionMock.mockResolvedValue(activeSubscription({ cancel_at_period_end: false }));

    await expect(reactivateSubscriptionAction()).resolves.toEqual({ error: 'not_cancelled' });
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns no_subscription when the subscription is already over', async () => {
    getSubscriptionMock.mockResolvedValue(
      activeSubscription({ status: 'canceled', cancel_at_period_end: true }),
    );

    await expect(reactivateSubscriptionAction()).resolves.toEqual({ error: 'no_subscription' });
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns a translatable code when Stripe fails', async () => {
    getSubscriptionMock.mockResolvedValue(activeSubscription({ cancel_at_period_end: true }));
    stripeMock.subscriptions.update.mockRejectedValue(new Error('Expired API Key provided'));

    await expect(reactivateSubscriptionAction()).resolves.toEqual({
      error: 'subscription_failed',
    });
  });

  it('returns subscription_missing when Stripe no longer has the subscription', async () => {
    getSubscriptionMock.mockResolvedValue(activeSubscription({ cancel_at_period_end: true }));
    stripeMock.subscriptions.update.mockRejectedValue(
      Object.assign(new Error("No such subscription: 'sub_123'"), {
        code: 'resource_missing',
        statusCode: 404,
      }),
    );

    await expect(reactivateSubscriptionAction()).resolves.toEqual({
      error: 'subscription_missing',
    });
  });

  it('throws for an unauthenticated caller', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(reactivateSubscriptionAction()).rejects.toThrow('Unauthorized');
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });
});
