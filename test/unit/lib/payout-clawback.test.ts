import { describe, expect, it } from 'vitest';
import {
  type ClawbackTarget,
  isChargeback,
  isDisputeClosed,
  isDisputeOpen,
  resolveClawbackTarget,
  reversalDeltaCents,
  reversalIdempotencyKey,
  targetReversedCents,
} from '@/lib/payouts/clawback';

/**
 * T-215 (+T-237). The arithmetic of taking a photographer's money back.
 *
 * These tests exist because the FIRST version of this module was delta-based and
 * two review passes found five money bugs in it. Each block below pins the
 * property whose absence caused one of them.
 */

const target = (reversedCents: number, chargeTotalCents: number): ClawbackTarget => ({
  reversedCents,
  chargeTotalCents,
});

describe('resolveClawbackTarget', () => {
  it('adds refunds and a lost dispute, capped at the charge', () => {
    // Settling a chargeback by refunding first is the NORMAL path, so the two
    // must not double-count.
    expect(
      resolveClawbackTarget({
        chargeAmountCents: 2000,
        chargeAmountRefundedCents: 2000,
        disputeLostAmountCents: 2000,
      }),
    ).toEqual({ reversedCents: 2000, chargeTotalCents: 2000 });

    expect(
      resolveClawbackTarget({
        chargeAmountCents: 2000,
        chargeAmountRefundedCents: 500,
        disputeLostAmountCents: 500,
      }),
    ).toEqual({ reversedCents: 1000, chargeTotalCents: 2000 });
  });

  it('returns null — never 0 — when the charge total is unusable', () => {
    // THE regression. The previous version passed `chargeTotal ?? 0` and called
    // it fail-closed; 0 is a usable number that reads as "nothing was refunded",
    // so the hold stayed fully payable and the cron paid out a charged-back sale
    // while the alert said the transfer had been reversed. `null` has nowhere to
    // fall through to.
    for (const bad of [0, -1, null, undefined, Number.NaN]) {
      expect(
        resolveClawbackTarget({
          chargeAmountCents: bad as number,
          chargeAmountRefundedCents: 500,
        }),
      ).toBeNull();
    }
  });

  it('treats a missing refunded amount as zero, not as unknown', () => {
    expect(
      resolveClawbackTarget({ chargeAmountCents: 2000, chargeAmountRefundedCents: undefined }),
    ).toEqual({ reversedCents: 0, chargeTotalCents: 2000 });
  });
});

describe('targetReversedCents', () => {
  it('is proportional on a partial reversal', () => {
    expect(targetReversedCents(1000, target(500, 2000))).toBe(250);
  });

  it('lands exactly on the full amount for a full reversal', () => {
    // By comparison, not arithmetic — so no rounding residue is left with the
    // photographer on a sale that was entirely taken back.
    expect(targetReversedCents(999, target(2000, 2000))).toBe(999);
    expect(targetReversedCents(999, target(2001, 2000))).toBe(999);
  });

  it('floors, so the platform absorbs the sub-cent', () => {
    // 1000 * 333 / 2000 = 166.5
    expect(targetReversedCents(1000, target(333, 2000))).toBe(166);
  });

  it('is zero when nothing was taken back', () => {
    expect(targetReversedCents(1000, target(0, 2000))).toBe(0);
  });
});

describe('reversalDeltaCents', () => {
  it('IS IDEMPOTENT: applying the same target repeatedly moves nothing after the first', () => {
    // The bug this replaces: the delta was computed against the row's CURRENT
    // amount, so every Stripe redelivery — routine here, because the access half
    // deliberately 500s on a transient DB error — reduced it again:
    // 2000 → 1500 → 1125 → 844 on a single €5 refund.
    const t = target(500, 2000);
    let reversed = 0;
    for (let i = 0; i < 5; i += 1) {
      reversed += reversalDeltaCents(1000, reversed, t);
    }
    expect(reversed).toBe(250);
  });

  it('IS ORDER-INDEPENDENT: refund-then-dispute equals dispute-then-refund', () => {
    const refundOnly = resolveClawbackTarget({
      chargeAmountCents: 2000,
      chargeAmountRefundedCents: 500,
    }) as ClawbackTarget;
    const both = resolveClawbackTarget({
      chargeAmountCents: 2000,
      chargeAmountRefundedCents: 500,
      disputeLostAmountCents: 500,
    }) as ClawbackTarget;

    // refund first, then the lost dispute
    let a = 0;
    a += reversalDeltaCents(1000, a, refundOnly);
    a += reversalDeltaCents(1000, a, both);

    // the lost dispute first, then the refund is reported
    let b = 0;
    b += reversalDeltaCents(1000, b, both);
    b += reversalDeltaCents(1000, b, refundOnly);

    expect(a).toBe(b);
    expect(a).toBe(500);
  });

  it('never reverses more than was transferred', () => {
    expect(reversalDeltaCents(1000, 1000, target(2000, 2000))).toBe(0);
    expect(reversalDeltaCents(1000, 900, target(2000, 2000))).toBe(100);
  });

  it('does nothing on a stale event reporting less than is already reversed', () => {
    expect(reversalDeltaCents(1000, 500, target(400, 2000))).toBe(0);
  });
});

describe('dispute status predicates', () => {
  it('separates inquiries from chargebacks', () => {
    // Inquiries arrive through the SAME `charge.dispute.created` event. Treating
    // them alike revoked a paying buyer's photos over a bank's suspicion, and
    // `warning_closed` restored nothing.
    for (const s of ['warning_needs_response', 'warning_under_review', 'warning_closed']) {
      expect(isChargeback(s)).toBe(false);
    }
    for (const s of ['needs_response', 'under_review', 'won', 'lost', 'prevented']) {
      expect(isChargeback(s)).toBe(true);
    }
  });

  it('knows every closing state the SDK declares', () => {
    for (const s of ['lost', 'won', 'warning_closed', 'prevented']) {
      expect(isDisputeClosed(s)).toBe(true);
      expect(isDisputeOpen(s)).toBe(false);
    }
    for (const s of ['needs_response', 'under_review', 'warning_needs_response']) {
      expect(isDisputeOpen(s)).toBe(true);
    }
  });
});

describe('reversalIdempotencyKey', () => {
  it('is stable for a redelivery and distinct for a bigger target', () => {
    expect(reversalIdempotencyKey('row-1', 250)).toBe(reversalIdempotencyKey('row-1', 250));
    expect(reversalIdempotencyKey('row-1', 250)).not.toBe(reversalIdempotencyKey('row-1', 500));
    expect(reversalIdempotencyKey('row-1', 250)).not.toBe(reversalIdempotencyKey('row-2', 250));
  });
});
