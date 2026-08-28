/**
 * `retrievePayoutOutlook` — the dates behind a photographer's balance (T-246).
 *
 * The screen answers "when do I get my money?", so the whole value of this
 * function is that every date on it is Stripe's own. Deriving one from
 * `delay_days` would look calculated and be wrong: an account on `delay_days: 7`
 * had its transfer land with `available_on` three days out, because the delay is
 * an input to Stripe's risk model rather than the formula.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const balanceRetrieve = vi.hoisted(() => vi.fn());
const payoutsList = vi.hoisted(() => vi.fn());
const balanceTransactionsList = vi.hoisted(() => vi.fn());

vi.mock('@/lib/stripe/config', () => ({
  stripe: {
    balance: { retrieve: balanceRetrieve },
    payouts: { list: payoutsList },
    balanceTransactions: { list: balanceTransactionsList },
  },
}));

import { retrievePayoutOutlook } from '@/lib/stripe/connect';

/** 2026-08-13T00:00:00Z */
const AUG_13 = 1786579200;
/** 2026-08-20T00:00:00Z */
const AUG_20 = 1787184000;

beforeEach(() => {
  vi.clearAllMocks();
  balanceRetrieve.mockResolvedValue({
    available: [{ amount: 0, currency: 'eur' }],
    pending: [{ amount: 183, currency: 'eur' }],
  });
  payoutsList.mockResolvedValue({ data: [] });
  balanceTransactionsList.mockResolvedValue({ data: [] });
});

describe('retrievePayoutOutlook', () => {
  it('sums the balance across currency buckets', async () => {
    balanceRetrieve.mockResolvedValue({
      available: [
        { amount: 100, currency: 'eur' },
        { amount: 50, currency: 'usd' },
      ],
      pending: [{ amount: 183, currency: 'eur' }],
    });

    const outlook = await retrievePayoutOutlook('acct_x');

    expect(outlook.availableCents).toBe(150);
    expect(outlook.pendingCents).toBe(183);
  });

  it('reports the SOONEST pending availability date', async () => {
    balanceTransactionsList.mockResolvedValue({
      data: [
        { status: 'pending', available_on: AUG_20 },
        { status: 'pending', available_on: AUG_13 },
        // Already available — not what anyone is waiting on.
        { status: 'available', available_on: 1 },
      ],
    });

    const outlook = await retrievePayoutOutlook('acct_x');

    expect(outlook.nextAvailableOn).toBe(new Date(AUG_13 * 1000).toISOString());
  });

  it('reports a payout that is still on its way', async () => {
    payoutsList.mockResolvedValue({
      data: [{ amount: 183, arrival_date: AUG_13, status: 'in_transit' }],
    });

    const outlook = await retrievePayoutOutlook('acct_x');

    expect(outlook.nextPayout).toEqual({
      amountCents: 183,
      arrivalDate: new Date(AUG_13 * 1000).toISOString(),
      status: 'in_transit',
    });
  });

  it('does not present an already-paid payout as upcoming', async () => {
    payoutsList.mockResolvedValue({
      data: [{ amount: 183, arrival_date: AUG_13, status: 'paid' }],
    });

    expect((await retrievePayoutOutlook('acct_x')).nextPayout).toBeNull();
  });

  it('goes quiet rather than guessing when Stripe cannot answer', async () => {
    // The balance still resolves; the date sources fail.
    payoutsList.mockRejectedValue(new Error('stripe is down'));
    balanceTransactionsList.mockRejectedValue(new Error('stripe is down'));

    const outlook = await retrievePayoutOutlook('acct_x');

    expect(outlook.pendingCents).toBe(183);
    expect(outlook.nextAvailableOn).toBeNull();
    expect(outlook.nextPayout).toBeNull();
  });

  it('never derives a date from the payout delay', async () => {
    // No pending transactions and no payouts ⇒ nothing is known, so nothing is
    // said. A `delay_days`-based fallback would fill this in with a wrong date.
    const outlook = await retrievePayoutOutlook('acct_x');

    expect(outlook.nextAvailableOn).toBeNull();
    expect(outlook.nextPayout).toBeNull();
  });
});
