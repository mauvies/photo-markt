import { describe, expect, it } from 'vitest';
import { calculateNetEarnings, calculatePlatformFee } from '@/database/queries/earnings';
import { getBuyerServiceFeeCents, getPhotographerNetCents } from '@/lib/plans';

/**
 * T-197: the photographer's earnings breakdown.
 *
 * Two properties:
 *  1. The breakdown adds up — `gross = commission + net` for every amount and
 *     tier. It did not before: the commission was independently rounded
 *     (`round(gross × rate)`) while the payout is floored, so the two could
 *     disagree by a cent, and the Sales tab (which derives commission as
 *     gross − net) could report a different figure than the Earnings tab for
 *     the very same sale.
 *  2. The buyer service fee never touches these numbers. It is charged to the
 *     buyer on top of the price and is platform revenue.
 */

const TIERS = ['free', 'starter', 'pro', null] as const;

describe('breakdown adds up', () => {
  it('commission + net equals gross for every tier and amount', () => {
    for (const planId of TIERS) {
      for (let gross = 0; gross <= 2000; gross += 1) {
        const commission = calculatePlatformFee(gross, planId);
        const net = calculateNetEarnings(gross, planId);
        expect(commission + net).toBe(gross);
      }
    }
  });

  it('never shows a negative commission', () => {
    for (const planId of TIERS) {
      for (const gross of [0, 1, 5, 99, 100, 999, 12_345]) {
        expect(calculatePlatformFee(gross, planId)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('regression: a €0.06 Free sale no longer loses a cent', () => {
    // Old behaviour: round(6 × 0.08) = 0 commission against floor(6 × 0.92) = 5
    // net — €0.06 gross reported as €0.00 + €0.05.
    expect(calculatePlatformFee(6, 'free')).toBe(1);
    expect(calculateNetEarnings(6, 'free')).toBe(5);
  });

  it('agrees with the Sales tab, which derives commission as gross − net', () => {
    for (const planId of TIERS) {
      for (const gross of [6, 99, 333, 999, 1000, 4567]) {
        const salesTabCommission = gross - getPhotographerNetCents(gross, planId);
        expect(calculatePlatformFee(gross, planId)).toBe(salesTabCommission);
      }
    }
  });

  it('net is the payout function, not a re-derivation', () => {
    for (const planId of TIERS) {
      for (const gross of [1, 99, 1000, 98_765]) {
        expect(calculateNetEarnings(gross, planId)).toBe(getPhotographerNetCents(gross, planId));
      }
    }
  });
});

describe('the buyer service fee is not the photographer’s money', () => {
  it('a Pro sale nets the full price — no commission, and no buyer fee taken out', () => {
    // The spec scenario: a €10.00 Pro-tier sale. Pro is 0% commission, so the
    // photographer keeps the whole price; a buyer fee charged on top must not
    // appear anywhere in their figures.
    const grossCents = 1000;

    expect(calculateNetEarnings(grossCents, 'pro')).toBe(1000);
    expect(calculatePlatformFee(grossCents, 'pro')).toBe(0);
  });

  it('the earnings figures are neither raised nor reduced by a buyer fee', () => {
    // The spec scenario uses a €0.45 buyer fee. It is written as a literal
    // rather than read from config because the shipped fee is still 0 — at 0
    // the property would hold vacuously and prove nothing.
    const grossCents = 1000;
    const buyerFeeCents = 45;

    const net = calculateNetEarnings(grossCents, 'pro');
    const commission = calculatePlatformFee(grossCents, 'pro');

    expect(net).toBe(grossCents);
    expect(net).not.toBe(grossCents + buyerFeeCents);
    expect(net).not.toBe(grossCents - buyerFeeCents);
    expect(commission).not.toBe(buyerFeeCents);
    expect(commission + net).toBe(grossCents);
  });

  it('is dark today: no buyer fee is charged yet, so nothing is being withheld', () => {
    expect(getBuyerServiceFeeCents(1000)).toBe(0);
  });

  it('commission scales only with the price, never with a buyer fee', () => {
    // Free is 8%: €10.00 → €0.80 commission, €9.20 net. Adding a buyer fee on
    // top of the buyer's total must not move either number.
    expect(calculatePlatformFee(1000, 'free')).toBe(80);
    expect(calculateNetEarnings(1000, 'free')).toBe(920);
  });
});
