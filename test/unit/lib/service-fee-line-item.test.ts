import { describe, expect, it, vi } from 'vitest';
import { PLATFORM_CURRENCY } from '@/lib/currency';

/**
 * T-196: the buyer service fee as a Stripe line item.
 *
 * The shipped fee amounts are 0 (dark launch), so the "fee is live" cases mock
 * the calc point rather than the constants — this asserts the line item is
 * built FROM `getBuyerServiceFeeCents` and never recomputed locally, which is
 * the property that keeps the charge equal to what the cart displayed.
 */

const getBuyerServiceFeeCentsMock = vi.hoisted(() => vi.fn<(subtotal: number) => number>());

vi.mock('@/lib/plans', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plans')>();
  return { ...actual, getBuyerServiceFeeCents: getBuyerServiceFeeCentsMock };
});

import {
  buildServiceFeeLineItem,
  SERVICE_FEE_LINE_ITEM_NAME,
} from '@/lib/stripe/service-fee-line-item';

describe('buildServiceFeeLineItem', () => {
  it('returns null when no fee is due — the kill-switch', () => {
    // With the fee configured at 0 the session must be byte-identical to v1:
    // no zero-amount line item, nothing on the receipt.
    getBuyerServiceFeeCentsMock.mockReturnValue(0);
    expect(buildServiceFeeLineItem(1000)).toBeNull();
  });

  it('takes its amount from the single calc point, never recomputed', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(45);
    const item = buildServiceFeeLineItem(1000);

    expect(getBuyerServiceFeeCentsMock).toHaveBeenCalledWith(1000);
    expect(item?.price_data?.unit_amount).toBe(45);
  });

  it('is a distinct, single-quantity line item in the platform currency', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(45);
    const item = buildServiceFeeLineItem(1000);

    expect(item?.quantity).toBe(1);
    expect(item?.price_data?.currency).toBe(PLATFORM_CURRENCY);
    expect(item?.price_data?.product_data?.name).toBe(SERVICE_FEE_LINE_ITEM_NAME);
  });

  it('never emits a negative or zero amount', () => {
    for (const fee of [0, -1, -100]) {
      getBuyerServiceFeeCentsMock.mockReturnValue(fee);
      expect(buildServiceFeeLineItem(1000)).toBeNull();
    }
  });

  it('passes the subtotal through untouched', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(30);
    buildServiceFeeLineItem(0);
    buildServiceFeeLineItem(12_345);

    expect(getBuyerServiceFeeCentsMock).toHaveBeenCalledWith(0);
    expect(getBuyerServiceFeeCentsMock).toHaveBeenCalledWith(12_345);
  });
});
