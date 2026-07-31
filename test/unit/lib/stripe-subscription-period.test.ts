/**
 * Unit tests for `subscriptionPeriodEndISO` (T-214, extracting T-159's rule).
 *
 * The rule this pins: `current_period_end` lives on `items.data[0]`, NOT on the
 * subscription root — Stripe's `basil` API version removed the root field and
 * our pinned version is well past it. Reading the root silently wrote `null`
 * once already, which is why this is one shared function instead of three
 * hand-written copies.
 */

import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { subscriptionPeriodEndISO } from '@/lib/stripe/subscription-period';

/** Minimal shape — only the fields the helper reads. */
function subscriptionWith(items: unknown): Stripe.Subscription {
  return { items } as unknown as Stripe.Subscription;
}

describe('subscriptionPeriodEndISO', () => {
  it('reads the period end off items.data[0] and converts epoch seconds to ISO', () => {
    const periodEnd = 1_924_992_000; // 2031-01-01T00:00:00Z
    const result = subscriptionPeriodEndISO(
      subscriptionWith({ data: [{ current_period_end: periodEnd }] }),
    );

    expect(result).toBe('2031-01-01T00:00:00.000Z');
    expect(new Date(result as string).getTime()).toBe(periodEnd * 1000);
  });

  it('ignores a value at the subscription ROOT — the field moved in basil', () => {
    const rootOnly = {
      current_period_end: 1_924_992_000,
      items: { data: [{ price: { id: 'price_pro' } }] },
    } as unknown as Stripe.Subscription;

    // If this ever returns a date, someone re-added the root read and the
    // helper stopped being the single source of the rule.
    expect(subscriptionPeriodEndISO(rootOnly)).toBeNull();
  });

  it('returns null when the item carries no period end', () => {
    expect(
      subscriptionPeriodEndISO(subscriptionWith({ data: [{ price: { id: 'p' } }] })),
    ).toBeNull();
  });

  it('returns null for an empty or missing item list rather than throwing', () => {
    expect(subscriptionPeriodEndISO(subscriptionWith({ data: [] }))).toBeNull();
    expect(subscriptionPeriodEndISO(subscriptionWith(undefined))).toBeNull();
  });

  it('returns null for a non-numeric period end instead of producing Invalid Date', () => {
    expect(
      subscriptionPeriodEndISO(subscriptionWith({ data: [{ current_period_end: '1924992000' }] })),
    ).toBeNull();
    expect(
      subscriptionPeriodEndISO(subscriptionWith({ data: [{ current_period_end: null }] })),
    ).toBeNull();
  });
});
