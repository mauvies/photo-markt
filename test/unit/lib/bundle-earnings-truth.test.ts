import { describe, expect, it } from 'vitest';
import {
  aggregateEarningsByOrder,
  calculateNetEarnings,
  calculatePlatformFee,
  sumGrossByOrder,
} from '@/database/queries/earnings';
import { allocateBundleTotalCents } from '@/lib/bundle-pricing';
import { getPhotographerNetCents } from '@/lib/plans';

/**
 * T-205 — the photographer's tabs tell the truth about a bundled sale.
 *
 * Two properties, both about money that actually moved:
 *  1. A bundled sale's gross is the ALLOCATED (charged) amount, so Sales and
 *     Earnings report the same gross/commission/net for it and the breakdown
 *     still adds up (the T-197 invariant, now on a discounted amount).
 *  2. The Earnings totals are netted per ORDER — the unit the webhook transfers
 *     in — so the reported net equals the payouts actually made. Netting the
 *     whole period's gross in one call reports up to a cent per order more than
 *     was ever transferred, because a sum of floors is not the floor of a sum.
 */

/** The spec's flagship case: 8 photos listing at €3.00, sold as a €19.90 pack. */
const LIST_UNIT_CENTS = 300;
const BUNDLE_TOTAL_CENTS = 1990;
const PHOTO_COUNT = 8;

describe('a bundled sale reports the charged amount, not the list total', () => {
  it('the allocation the order rows are built from sums to the bundle total', () => {
    const allocated = allocateBundleTotalCents(BUNDLE_TOTAL_CENTS, PHOTO_COUNT);
    expect(allocated).toHaveLength(PHOTO_COUNT);
    expect(allocated.reduce((sum, cents) => sum + cents, 0)).toBe(BUNDLE_TOTAL_CENTS);
    // And it is emphatically not the list total, which is what the tabs used to
    // have no way of distinguishing.
    expect(BUNDLE_TOTAL_CENTS).not.toBe(PHOTO_COUNT * LIST_UNIT_CENTS);
  });

  it('Sales and Earnings derive the same breakdown for each allocated row', () => {
    const allocated = allocateBundleTotalCents(BUNDLE_TOTAL_CENTS, PHOTO_COUNT);

    for (const planId of ['free', 'starter', 'pro', null] as const) {
      for (const grossCents of allocated) {
        // Both tabs now call these two functions — same input, same output.
        const commission = calculatePlatformFee(grossCents, planId);
        const net = calculateNetEarnings(grossCents, planId);

        expect(commission + net).toBe(grossCents);
        expect(net).toBe(getPhotographerNetCents(grossCents, planId));
      }
    }
  });

  it('the whole order is reported against 1990, never against the 2400 list price', () => {
    const allocated = allocateBundleTotalCents(BUNDLE_TOTAL_CENTS, PHOTO_COUNT);
    const { grossCents, platformFeeCents, netCents } = aggregateEarningsByOrder(
      sumGrossByOrder(allocated.map((cents) => ({ orderId: 'order-1', totalPriceCents: cents }))),
      'free',
    );

    expect(grossCents).toBe(1990);
    expect(netCents).toBe(getPhotographerNetCents(1990, 'free'));
    expect(netCents).not.toBe(getPhotographerNetCents(2400, 'free'));
    expect(platformFeeCents + netCents).toBe(grossCents);
  });
});

describe('earnings totals equal the transfers actually made', () => {
  it('nets per order, matching the one transfer the webhook makes per order', () => {
    // 513 cents is the adversarial case: 513 × 0.92 = 471.96, so each order
    // loses 0.96 of a cent to the floor and two orders together lose almost two.
    const orders = [513, 513];
    const transferred = orders.reduce(
      (sum, gross) => sum + getPhotographerNetCents(gross, 'free'),
      0,
    );

    const { grossCents, netCents, platformFeeCents } = aggregateEarningsByOrder(orders, 'free');

    expect(netCents).toBe(transferred); // 942
    // What the period-aggregate netting reported instead — a cent nobody ever
    // received, and which therefore could never be withdrawn.
    expect(getPhotographerNetCents(grossCents, 'free')).toBe(943);
    expect(netCents).not.toBe(getPhotographerNetCents(grossCents, 'free'));
    expect(platformFeeCents + netCents).toBe(grossCents);
  });

  it('a mixed period of bundled and single sales sums to the payouts made', () => {
    // One bundled order (allocated across 3 photos) and two single sales.
    const bundled = allocateBundleTotalCents(999, 3).map((cents) => ({
      orderId: 'order-bundle',
      totalPriceCents: cents,
    }));
    const singles = [
      { orderId: 'order-single-1', totalPriceCents: 513 },
      { orderId: 'order-single-2', totalPriceCents: 700 },
    ];

    const perOrderGross = sumGrossByOrder([...bundled, ...singles]);
    expect(perOrderGross.sort((a, b) => a - b)).toEqual([513, 700, 999]);

    const transferred = [999, 513, 700].reduce(
      (sum, gross) => sum + getPhotographerNetCents(gross, 'free'),
      0,
    );
    const { grossCents, netCents, platformFeeCents } = aggregateEarningsByOrder(
      perOrderGross,
      'free',
    );

    expect(grossCents).toBe(999 + 513 + 700);
    expect(netCents).toBe(transferred);
    expect(platformFeeCents + netCents).toBe(grossCents);
  });

  it('the breakdown adds up for every plan and any set of orders', () => {
    const orderSets = [[], [1], [6, 6, 6], [513, 999, 1, 250_000], [99, 100, 101]];
    for (const planId of ['free', 'starter', 'pro', null] as const) {
      for (const orders of orderSets) {
        const { grossCents, platformFeeCents, netCents } = aggregateEarningsByOrder(orders, planId);
        expect(platformFeeCents + netCents).toBe(grossCents);
        expect(platformFeeCents).toBeGreaterThanOrEqual(0);
        expect(netCents).toBeLessThanOrEqual(grossCents);
      }
    }
  });

  it('groups line items by order, not by photo', () => {
    const perOrder = sumGrossByOrder([
      { orderId: 'a', totalPriceCents: 334 },
      { orderId: 'a', totalPriceCents: 333 },
      { orderId: 'a', totalPriceCents: 333 },
      { orderId: 'b', totalPriceCents: 500 },
    ]);
    expect(perOrder).toEqual([1000, 500]);
  });
});
