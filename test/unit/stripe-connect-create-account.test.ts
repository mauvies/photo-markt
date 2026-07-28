/**
 * Unit tests for `createExpressAccount` (`src/lib/stripe/connect.ts`).
 *
 * Regression for T-191: in livemode a photographer with a US account could not
 * connect their payout account because `stripe.accounts.create` was called with
 * only `capabilities: { transfers: { requested: true } }`. Stripe forbids
 * requesting `transfers` for a US connected account without also requesting
 * `card_payments` and 400s the request. The fix requests `card_payments`
 * *only* for US so non-US onboarding stays minimal (destination-transfer
 * recipients only need `transfers`).
 *
 * Stripe is mocked at the config boundary so this runs with no network/DB.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { accounts: { create: vi.fn() } },
}));

vi.mock('@/lib/stripe/config', () => ({ stripe: stripeMock }));

import { createExpressAccount } from '@/lib/stripe/connect';

describe('createExpressAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeMock.accounts.create.mockResolvedValue({ id: 'acct_123' });
  });

  it('requests card_payments alongside transfers for US accounts (T-191)', async () => {
    await createExpressAccount({ email: 'us@example.com', country: 'US' });

    expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1);
    const params = stripeMock.accounts.create.mock.calls[0][0];
    expect(params.capabilities).toEqual({
      transfers: { requested: true },
      card_payments: { requested: true },
    });
  });

  it('requests only transfers for non-US accounts (no regression)', async () => {
    await createExpressAccount({ email: 'es@example.com', country: 'ES' });

    const params = stripeMock.accounts.create.mock.calls[0][0];
    expect(params.capabilities).toEqual({ transfers: { requested: true } });
    expect(params.capabilities.card_payments).toBeUndefined();
  });

  it('returns the created account id', async () => {
    const id = await createExpressAccount({ email: 'us@example.com', country: 'US' });
    expect(id).toBe('acct_123');
  });
});
