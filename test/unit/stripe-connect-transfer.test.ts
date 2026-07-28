/**
 * Unit tests for `createTransfer` (`src/lib/stripe/connect.ts`).
 *
 * Regression for T-193. Photographer payouts use Stripe "separate charges and
 * transfers": each transfer is created with a `source_transaction` (the charge),
 * and Stripe requires the transfer currency to match the charge currency. The
 * charge is now created in EUR (`PLATFORM_CURRENCY`), so a transfer still
 * hardcoded to USD would fail with a currency mismatch and strand the
 * photographer's payout. This pins the transfer to the platform currency.
 *
 * Stripe is mocked at the config boundary so this runs with no network/DB.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { transfers: { create: vi.fn() } },
}));

vi.mock('@/lib/stripe/config', () => ({ stripe: stripeMock }));

import { createTransfer } from '@/lib/stripe/connect';

describe('createTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeMock.transfers.create.mockResolvedValue({ id: 'tr_123' });
  });

  it('forwards the EUR charge currency to the transfer (T-193)', async () => {
    await createTransfer({
      amountCents: 900,
      currency: 'eur',
      destination: 'acct_123',
      sourceTransaction: 'ch_123',
      transferGroup: 'order_1',
      idempotencyKey: 'transfer_ch_123_pg_1',
    });

    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    const [params, options] = stripeMock.transfers.create.mock.calls[0];
    expect(params).toMatchObject({
      amount: 900,
      currency: 'eur',
      destination: 'acct_123',
      source_transaction: 'ch_123',
      transfer_group: 'order_1',
    });
    expect(options).toEqual({ idempotencyKey: 'transfer_ch_123_pg_1' });
  });

  // The transfer currency must equal the SOURCE CHARGE currency, not a global
  // constant. A charge made before the USD→EUR switch settles in USD; its
  // post-deploy transfer must still be USD or Stripe rejects it and the payout
  // is stranded. createTransfer forwards whatever currency it's given.
  it('forwards a legacy USD charge currency unchanged (no forced EUR)', async () => {
    await createTransfer({
      amountCents: 99,
      currency: 'usd',
      destination: 'acct_legacy',
      sourceTransaction: 'ch_usd',
      idempotencyKey: 'transfer_ch_usd_pg_legacy',
    });

    const [params] = stripeMock.transfers.create.mock.calls[0];
    expect(params).toMatchObject({ amount: 99, currency: 'usd', source_transaction: 'ch_usd' });
  });
});
