/**
 * Unit tests for `retrieveConnectBalance` (`src/lib/stripe/connect.ts`).
 *
 * Regression for T-152 (stripe-node v20 → v22 upgrade). v22 separates request
 * *params* from request *options*: the connected-account header
 * (`stripeAccount`) is a RequestOption (2nd arg) and is no longer accepted
 * inside the params object. Under v20 the code called
 * `stripe.balance.retrieve({ stripeAccount })` — a single-arg form that v22's
 * types reject and that would send the header in the wrong position. These
 * assertions pin the corrected 2-arg call shape (params `undefined`, options
 * `{ stripeAccount }`) so the fix can't silently regress, plus the
 * platform-currency-only (EUR, T-193) summation the balance helper performs.
 *
 * Stripe is mocked at the config boundary so this runs with no network/DB.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { balance: { retrieve: vi.fn() } },
}));

vi.mock('@/lib/stripe/config', () => ({ stripe: stripeMock }));

import { retrieveConnectBalance } from '@/lib/stripe/connect';

describe('retrieveConnectBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes stripeAccount as a request option (2nd arg), not a param (v22 separation)', async () => {
    stripeMock.balance.retrieve.mockResolvedValueOnce({ available: [], pending: [] });

    await retrieveConnectBalance('acct_123');

    // The v22 breaking change: `stripeAccount` must live in RequestOptions.
    // Under v20 this was `retrieve({ stripeAccount })` — the single-arg form
    // that would fail this assertion.
    expect(stripeMock.balance.retrieve).toHaveBeenCalledWith(undefined, {
      stripeAccount: 'acct_123',
    });
  });

  it('sums the EUR balance of a EUR-settling account (T-193)', async () => {
    stripeMock.balance.retrieve.mockResolvedValueOnce({
      available: [{ currency: 'eur', amount: 2000 }],
      pending: [{ currency: 'eur', amount: 300 }],
    });

    const result = await retrieveConnectBalance('acct_123');

    expect(result).toEqual({ available: 2000, pending: 300 });
  });

  it('still surfaces a legacy USD account balance instead of hiding it (T-193 review)', async () => {
    // A photographer whose funds settled in USD (pre-EUR sale, non-EU account)
    // must not see €0 while real money sits in the account — the balance is
    // summed regardless of currency rather than filtered to a hardcoded one.
    stripeMock.balance.retrieve.mockResolvedValueOnce({
      available: [{ currency: 'usd', amount: 2000 }],
      pending: [{ currency: 'usd', amount: 300 }],
    });

    const result = await retrieveConnectBalance('acct_legacy');

    expect(result).toEqual({ available: 2000, pending: 300 });
  });
});
