import { describe, expect, it } from 'vitest';
import { resolveMoneyOnItsWay } from '@/lib/payouts/money-outlook';

/**
 * T-247 — the single "your money" figure and its date.
 *
 * The point of the kernel is that it can only ever say what Stripe said. The
 * tests that matter are therefore the negative ones: no money means no card, and
 * no date from Stripe means no date on screen.
 */

const NONE = {
  availableCents: 0,
  pendingCents: 0,
  nextAvailableOn: null,
  nextPayout: null,
};

describe('resolveMoneyOnItsWay', () => {
  it('adds what Stripe holds to what is available — one pot, as the photographer sees it', () => {
    const result = resolveMoneyOnItsWay({ ...NONE, availableCents: 500, pendingCents: 183 });

    expect(result?.totalCents).toBe(683);
  });

  it('renders nothing at all when there is no money in flight', () => {
    // A "€0.00, arriving on no date" card is noise, not information.
    expect(resolveMoneyOnItsWay(NONE)).toBeNull();
    expect(resolveMoneyOnItsWay(null)).toBeNull();
  });

  it('prefers the bank arrival date over the settlement date', () => {
    // A scheduled payout names the day the money LANDS; `available_on` only
    // names the day it stops being held. The former is the better answer.
    const result = resolveMoneyOnItsWay({
      availableCents: 183,
      pendingCents: 0,
      nextAvailableOn: '2026-08-13T00:00:00.000Z',
      nextPayout: {
        amountCents: 183,
        arrivalDate: '2026-08-15T00:00:00.000Z',
        status: 'in_transit',
      },
    });

    expect(result?.timing).toEqual({ kind: 'arriving', date: '2026-08-15T00:00:00.000Z' });
  });

  it('falls back to the settlement date while nothing is scheduled', () => {
    const result = resolveMoneyOnItsWay({
      ...NONE,
      pendingCents: 183,
      nextAvailableOn: '2026-08-13T00:00:00.000Z',
    });

    expect(result?.timing).toEqual({ kind: 'available-on', date: '2026-08-13T00:00:00.000Z' });
  });

  it('says "ready" for money that is available with no payout yet', () => {
    const result = resolveMoneyOnItsWay({ ...NONE, availableCents: 183 });

    expect(result?.timing).toEqual({ kind: 'ready' });
  });

  it('never invents a date when Stripe gave none', () => {
    // Pending money, no `available_on` — Stripe could not be read. The one thing
    // this must not do is guess a day.
    const result = resolveMoneyOnItsWay({ ...NONE, pendingCents: 183 });

    expect(result?.totalCents).toBe(183);
    expect(result?.timing).toEqual({ kind: 'unknown' });
  });

  it('ignores a negative balance rather than subtracting it', () => {
    // A clawed-back account can go negative at Stripe; showing "you are owed
    // minus three euros" helps nobody.
    const result = resolveMoneyOnItsWay({ ...NONE, availableCents: -300, pendingCents: 183 });

    expect(result?.totalCents).toBe(183);
  });
});
