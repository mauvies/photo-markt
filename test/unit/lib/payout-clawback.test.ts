import { describe, expect, it } from 'vitest';
import {
  computeReducedHoldCents,
  computeReversalCents,
  isFullReversal,
  reversalIdempotencyKey,
} from '@/lib/payouts/clawback';

/**
 * T-215 (+ T-237). The arithmetic of taking a photographer's money back.
 *
 * Two properties carry the most weight here:
 *   - a partial reversal is PROPORTIONAL, on both money already sent and money
 *     still held — before this, any partial refund voided the whole hold and the
 *     photographer irrecoverably lost their net on the part that was never
 *     refunded (T-237);
 *   - no sequence of events can claw back more than was transferred, however
 *     Stripe redelivers or reorders them.
 */

describe('isFullReversal', () => {
  it('treats a charge refunded up to its total as full', () => {
    expect(isFullReversal(2000, 2000)).toBe(true);
    // Several partial refunds can accumulate to the total.
    expect(isFullReversal(2001, 2000)).toBe(true);
    expect(isFullReversal(1999, 2000)).toBe(false);
  });

  it('refuses to call anything full when the charge total is unusable', () => {
    // Fails closed: without a denominator there is no proportion to take, and
    // guessing "full" would claw back everything on a bad payload.
    expect(isFullReversal(500, 0)).toBe(false);
    expect(isFullReversal(500, Number.NaN)).toBe(false);
  });
});

describe('computeReversalCents', () => {
  const base = { payoutAmountCents: 1000, alreadyReversedCents: 0, chargeCents: 2000 };

  it('reverses the whole payout when the whole charge comes back', () => {
    expect(computeReversalCents({ ...base, reversedCents: 2000 })).toBe(1000);
  });

  it('reverses proportionally on a partial refund', () => {
    // A quarter of the charge → a quarter of the photographer's net.
    expect(computeReversalCents({ ...base, reversedCents: 500 })).toBe(250);
  });

  it('floors, so the platform absorbs the sub-cent and not the photographer', () => {
    // 1000 * 333 / 2000 = 166.5
    expect(computeReversalCents({ ...base, reversedCents: 333 })).toBe(166);
  });

  it('returns only the delta once part has already been reversed', () => {
    // Cumulative 50% target = 500, of which 250 is already back.
    expect(computeReversalCents({ ...base, alreadyReversedCents: 250, reversedCents: 1000 })).toBe(
      250,
    );
  });

  it('never reverses more than was transferred, whatever the events say', () => {
    expect(computeReversalCents({ ...base, alreadyReversedCents: 900, reversedCents: 2000 })).toBe(
      100,
    );
    expect(computeReversalCents({ ...base, alreadyReversedCents: 1000, reversedCents: 2000 })).toBe(
      0,
    );
  });

  it('does nothing on a stale event reporting less than is already reversed', () => {
    // Out-of-order redelivery: a negative "reversal" is not an error to raise,
    // it is an instruction to do nothing.
    expect(computeReversalCents({ ...base, alreadyReversedCents: 500, reversedCents: 400 })).toBe(
      0,
    );
  });

  it('is a no-op for a payout that carried no money', () => {
    expect(computeReversalCents({ ...base, payoutAmountCents: 0, reversedCents: 2000 })).toBe(0);
  });

  it('reverses nothing when the charge total is missing rather than guessing', () => {
    expect(computeReversalCents({ ...base, chargeCents: 0, reversedCents: 500 })).toBe(0);
  });
});

describe('computeReducedHoldCents', () => {
  it('voids the hold on a full refund (T-216 behaviour, unchanged)', () => {
    expect(
      computeReducedHoldCents({ amountCents: 1000, reversedCents: 2000, chargeCents: 2000 }),
    ).toBe(null);
  });

  it('KEEPS the hold with a reduced amount on a partial refund', () => {
    // The T-237 regression: refunding a quarter must not destroy the
    // photographer's net on the other three quarters.
    expect(
      computeReducedHoldCents({ amountCents: 1000, reversedCents: 500, chargeCents: 2000 }),
    ).toBe(750);
  });

  it('always leaves at least a payable cent on a partial refund', () => {
    // Flooring the deduction guarantees this, which is why only a FULL refund
    // voids a hold. It matters because `payouts.amount_cents` has a `> 0` CHECK:
    // a survivor of 0 could not be written at all.
    expect(
      computeReducedHoldCents({ amountCents: 2, reversedCents: 1999, chargeCents: 2000 }),
    ).toBe(1);
    expect(
      computeReducedHoldCents({ amountCents: 1, reversedCents: 1999, chargeCents: 2000 }),
    ).toBe(1);
  });

  it('voids a hold that carries no money', () => {
    expect(computeReducedHoldCents({ amountCents: 0, reversedCents: 500, chargeCents: 2000 })).toBe(
      null,
    );
  });

  it('voids rather than guessing when the charge total is missing', () => {
    // The two sides fail closed in OPPOSITE directions, and that asymmetry is the
    // point: not sending money is recoverable (the row can be restored), sending
    // it is not. `undefined <= 0` is false in JS, so an absent `charge.amount`
    // would otherwise sail past a naive guard and make the proportion NaN.
    const missing = undefined as unknown as number;
    expect(
      computeReducedHoldCents({ amountCents: 1000, reversedCents: 500, chargeCents: missing }),
    ).toBe(null);
    expect(
      computeReversalCents({
        payoutAmountCents: 1000,
        alreadyReversedCents: 0,
        reversedCents: 500,
        chargeCents: missing,
      }),
    ).toBe(0);
  });

  it('leaves the hold untouched when nothing was reversed', () => {
    expect(
      computeReducedHoldCents({ amountCents: 1000, reversedCents: 0, chargeCents: 2000 }),
    ).toBe(1000);
  });
});

describe('reversalIdempotencyKey', () => {
  it('is stable for a redelivery of the same event', () => {
    expect(reversalIdempotencyKey('row-1', 500)).toBe(reversalIdempotencyKey('row-1', 500));
  });

  it('differs for a second, larger partial refund on the same charge', () => {
    // The whole reason the key is NOT `(transfer, charge)`: that pair is constant
    // across successive partial refunds, so the second refund would reuse the
    // first's key, Stripe would return the first reversal, and the photographer
    // would silently keep money the buyer got back.
    expect(reversalIdempotencyKey('row-1', 500)).not.toBe(reversalIdempotencyKey('row-1', 900));
  });

  it('differs per payout row', () => {
    expect(reversalIdempotencyKey('row-1', 500)).not.toBe(reversalIdempotencyKey('row-2', 500));
  });
});
