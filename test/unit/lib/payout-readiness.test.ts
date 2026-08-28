/**
 * T-248 — a priced event could be published with no payout account, and nothing
 * said so. The product decision is that the sale still HAPPENS (the webhook
 * records the net as a `connect_inactive` hold and the retry worker pays it on
 * activation), so what is pinned here is the warning's decision, not a block.
 *
 * The three severities are the point: a priced event is a forecast ("sales will
 * be held"), an outstanding hold is a fact ("€X of yours is waiting"). Dressing
 * the forecast in the same urgency as the fact teaches the photographer to
 * ignore both.
 */

import { describe, expect, it } from 'vitest';
import {
  canReceivePayouts,
  eventEarningsWillBeHeld,
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

  it('says nothing at all once Connect is active, even with money in flight', () => {
    expect(
      resolvePayoutReadiness({ connectStatus: 'active', pricedEventCount: 228, heldCents: 5000 }),
    ).toBeNull();
    expect(
      resolvePayoutReadiness({ connectStatus: 'active', pricedEventCount: 0, heldCents: 0 }),
    ).toBeNull();
  });

  it('ranks money already held above events that merely carry a price', () => {
    expect(
      resolvePayoutReadiness({
        connectStatus: 'not_connected',
        pricedEventCount: 3,
        heldCents: 1250,
      }),
    ).toBe('money_held');
    // A single cent of stuck money still outranks the forecast.
    expect(
      resolvePayoutReadiness({ connectStatus: 'restricted', pricedEventCount: 0, heldCents: 1 }),
    ).toBe('money_held');
  });

  it('warns that sales will be held when events are priced but nothing has sold', () => {
    expect(
      resolvePayoutReadiness({ connectStatus: 'not_connected', pricedEventCount: 1, heldCents: 0 }),
    ).toBe('sales_will_hold');
    expect(
      resolvePayoutReadiness({ connectStatus: 'pending', pricedEventCount: 3, heldCents: 0 }),
    ).toBe('sales_will_hold');
  });

  it('falls back to the plain setup nudge when nothing is priced and nothing is held', () => {
    expect(
      resolvePayoutReadiness({ connectStatus: 'not_connected', pricedEventCount: 0, heldCents: 0 }),
    ).toBe('setup_pending');
  });

  it('flags a single event only when it is both priced and unpayable', () => {
    expect(eventEarningsWillBeHeld({ pricePerPhoto: 6.5, connectStatus: 'not_connected' })).toBe(
      true,
    );
    expect(eventEarningsWillBeHeld({ pricePerPhoto: 6.5, connectStatus: 'active' })).toBe(false);
    expect(eventEarningsWillBeHeld({ pricePerPhoto: null, connectStatus: 'not_connected' })).toBe(
      false,
    );
    expect(eventEarningsWillBeHeld({ pricePerPhoto: 0, connectStatus: 'restricted' })).toBe(false);
  });
});
