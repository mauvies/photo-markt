/**
 * T-248 — a priced event could be published with no payout account, and nothing
 * said so. The product decision is to ALLOW it (preparing an event and getting
 * paid for it are separate jobs) and warn loudly instead, so the thing worth
 * pinning is the warning's decision, not a block.
 *
 * The severity split matters: with priced events the missing account is not a
 * pending setup step, it is sales being refused at checkout right now — both
 * checkouts return `photographer_not_connected`.
 */

import { describe, expect, it } from 'vitest';
import {
  canReceivePayouts,
  eventSalesBlockedByPayouts,
  isPricedEvent,
  resolvePayoutReadiness,
} from '@/lib/payouts/payout-readiness';

describe('payout readiness', () => {
  it('only an active Connect account can receive money', () => {
    expect(canReceivePayouts('active')).toBe(true);
    for (const status of ['not_connected', 'pending', 'restricted'] as const) {
      expect(canReceivePayouts(status)).toBe(false);
    }
  });

  it('treats null and 0 as free — a free event needs no payout account', () => {
    expect(isPricedEvent(null)).toBe(false);
    expect(isPricedEvent(undefined)).toBe(false);
    expect(isPricedEvent(0)).toBe(false);
    expect(isPricedEvent(6.5)).toBe(true);
  });

  it('says nothing at all once Connect is active', () => {
    expect(resolvePayoutReadiness({ connectStatus: 'active', pricedEventCount: 228 })).toBeNull();
    expect(resolvePayoutReadiness({ connectStatus: 'active', pricedEventCount: 0 })).toBeNull();
  });

  it('escalates to sales_blocked only when priced events exist', () => {
    expect(resolvePayoutReadiness({ connectStatus: 'not_connected', pricedEventCount: 1 })).toBe(
      'sales_blocked',
    );
    expect(resolvePayoutReadiness({ connectStatus: 'pending', pricedEventCount: 3 })).toBe(
      'sales_blocked',
    );
    // Nothing priced yet: still just an unfinished setup step.
    expect(resolvePayoutReadiness({ connectStatus: 'not_connected', pricedEventCount: 0 })).toBe(
      'setup_pending',
    );
  });

  it('flags a single event only when it is both priced and unpayable', () => {
    expect(eventSalesBlockedByPayouts({ pricePerPhoto: 6.5, connectStatus: 'not_connected' })).toBe(
      true,
    );
    expect(eventSalesBlockedByPayouts({ pricePerPhoto: 6.5, connectStatus: 'active' })).toBe(false);
    expect(
      eventSalesBlockedByPayouts({ pricePerPhoto: null, connectStatus: 'not_connected' }),
    ).toBe(false);
    expect(eventSalesBlockedByPayouts({ pricePerPhoto: 0, connectStatus: 'restricted' })).toBe(
      false,
    );
  });
});
