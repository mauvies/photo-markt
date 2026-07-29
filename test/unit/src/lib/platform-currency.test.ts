/**
 * Unit tests for the platform currency constant and its consumers (T-193).
 *
 * The platform account settles in EUR; charging in USD forced a ~2% currency-
 * conversion fee on every sale. `PLATFORM_CURRENCY` is the single source of
 * truth so the charge currency can't silently drift back to USD, and the
 * plan-price formatter must render the matching symbol.
 */

import { describe, expect, it } from 'vitest';
import {
  PLATFORM_CURRENCY,
  PLATFORM_CURRENCY_CODE,
  PLATFORM_CURRENCY_SYMBOL,
} from '@/lib/currency';
import { formatPlanPrice, getPlanById } from '@/lib/plans';

describe('platform currency', () => {
  it('is EUR in every form (Stripe lowercase, Intl code, symbol)', () => {
    expect(PLATFORM_CURRENCY).toBe('eur');
    expect(PLATFORM_CURRENCY_CODE).toBe('EUR');
    expect(PLATFORM_CURRENCY_SYMBOL).toBe('€');
  });

  it('formatPlanPrice renders the euro symbol, not a dollar sign', () => {
    const starter = getPlanById('starter');
    expect(starter).toBeDefined();
    if (!starter) return;
    const monthly = formatPlanPrice(starter, 'monthly');
    expect(monthly.startsWith('€')).toBe(true);
    expect(monthly).not.toContain('$');
    // Starter was repriced to 9.99 in billing v2 (T-195); the point of this
    // assertion is the currency, and the amount is pinned in plans.test.ts.
    expect(monthly).toBe('€9.99/mo');
  });

  it('formatPlanPrice returns Free for the free plan (no currency)', () => {
    const free = getPlanById('free');
    expect(free).toBeDefined();
    if (!free) return;
    expect(formatPlanPrice(free)).toBe('Free');
  });
});
