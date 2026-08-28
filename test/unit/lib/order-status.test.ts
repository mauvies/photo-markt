import { describe, expect, it } from 'vitest';
import { isFullyRefunded, resolveOrderStatus } from '@/lib/payouts/order-status';

/**
 * T-215. Buyer access is `status = 'completed'` and nothing else, so this
 * function decides what ~13 read paths grant.
 *
 * It exists because the first implementation moved the status with verbs, and
 * the verbs did not compose: settling a chargeback by refunding the buyer (the
 * normal path) left the order `refunded`, and then winning the dispute called
 * "restore" and handed a fully refunded buyer permanent access to the originals.
 */

describe('resolveOrderStatus', () => {
  const facts = (over: Partial<Parameters<typeof resolveOrderStatus>[0]> = {}) =>
    resolveOrderStatus({
      fullyRefunded: false,
      chargebackOpen: false,
      chargebackLost: false,
      ...over,
    });

  it('grants access when nothing has happened', () => {
    expect(facts()).toBe('completed');
  });

  it('revokes on a full refund and on an open or lost chargeback', () => {
    expect(facts({ fullyRefunded: true })).toBe('refunded');
    expect(facts({ chargebackOpen: true })).toBe('disputed');
    expect(facts({ chargebackLost: true })).toBe('disputed');
  });

  it('KEEPS a refunded buyer revoked when the dispute is later won', () => {
    // The exact sequence that broke the old model: dispute opened → refunded to
    // settle it → bank closes it in our favour. There is no "restore" to call,
    // so the refund still decides.
    expect(facts({ fullyRefunded: true, chargebackOpen: false, chargebackLost: false })).toBe(
      'refunded',
    );
  });

  it('is a pure function of the facts, so repeated application is a no-op', () => {
    const f = { fullyRefunded: false, chargebackOpen: true, chargebackLost: false };
    expect(resolveOrderStatus(f)).toBe(resolveOrderStatus(f));
  });
});

describe('isFullyRefunded', () => {
  it('needs the whole charge back', () => {
    expect(isFullyRefunded(2000, 2000)).toBe(true);
    expect(isFullyRefunded(2000, 2001)).toBe(true);
    // ⚠️ A partial refund deliberately does NOT revoke: Stripe refunds are
    // amounts, not line items, and revoking everything also broke the balance
    // identity by dropping the whole sale out of the photographer's net.
    expect(isFullyRefunded(2000, 1999)).toBe(false);
    expect(isFullyRefunded(2000, 0)).toBe(false);
  });

  it('is false rather than true when the amounts are unusable', () => {
    expect(isFullyRefunded(undefined, 2000)).toBe(false);
    expect(isFullyRefunded(0, 0)).toBe(false);
    expect(isFullyRefunded(2000, undefined)).toBe(false);
  });
});
