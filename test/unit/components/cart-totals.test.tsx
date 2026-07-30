/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-196: the cart money summary. The disclosure requirement is that the buyer
 * sees the fee and the full total BEFORE reaching Stripe, and that what is
 * displayed equals what is charged — so these assert the component reads the
 * same calc point the checkout does.
 */

const getBuyerServiceFeeCentsMock = vi.hoisted(() => vi.fn<(subtotal: number) => number>());

vi.mock('@/lib/plans', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plans')>();
  return { ...actual, getBuyerServiceFeeCents: getBuyerServiceFeeCentsMock };
});

import { CartTotals } from '@/components/cart-totals';

afterEach(cleanup);

const labels = {
  subtotal: 'Subtotal',
  serviceFee: 'Service fee',
  total: 'Total',
  free: 'Free',
  bundleDiscount: 'Volume discount',
};

describe('CartTotals with the fee disabled (shipped state)', () => {
  it('renders only the subtotal — no fee line, no total line', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(0);
    render(<CartTotals subtotalCents={1000} labels={labels} />);

    expect(screen.getByText('Subtotal')).toBeDefined();
    expect(screen.getByText('€10.00')).toBeDefined();
    expect(screen.queryByText('Service fee')).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('keeps the pre-existing "Free" wording for an all-free cart', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(0);
    render(<CartTotals subtotalCents={0} labels={labels} />);

    expect(screen.getByText('Free')).toBeDefined();
    expect(screen.queryByText('€0.00')).toBeNull();
  });
});

describe('CartTotals with the fee live', () => {
  it('shows subtotal, the labelled fee, and a total equal to their sum', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(45);
    render(<CartTotals subtotalCents={1000} labels={labels} />);

    expect(screen.getByText('Subtotal')).toBeDefined();
    expect(screen.getByText('€10.00')).toBeDefined();
    expect(screen.getByText('Service fee')).toBeDefined();
    expect(screen.getByText('€0.45')).toBeDefined();
    expect(screen.getByText('Total')).toBeDefined();
    expect(screen.getByText('€10.45')).toBeDefined();
  });

  it('derives the fee from the same calc point the checkout charges from', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(45);
    render(<CartTotals subtotalCents={1000} labels={labels} />);

    expect(getBuyerServiceFeeCentsMock).toHaveBeenCalledWith(1000);
  });

  it('totals correctly when the fee rounds to a whole euro boundary', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(55);
    render(<CartTotals subtotalCents={945} labels={labels} />);

    expect(screen.getByText('€10.00')).toBeDefined();
  });

  it('renders the same three rows in the mobile variant', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(30);
    render(<CartTotals subtotalCents={500} labels={labels} variant="mobile" />);

    expect(screen.getByText('Subtotal')).toBeDefined();
    expect(screen.getByText('Service fee')).toBeDefined();
    expect(screen.getByText('€5.30')).toBeDefined();
  });
});

/**
 * T-204: the volume-discount row. The ORDER of operations is the point — the fee
 * rides on the post-discount subtotal, because that is what the buyer is actually
 * charged for the photos.
 */
describe('CartTotals with a bundle discount', () => {
  it('shows the discount as its own row and totals subtotal − discount + fee', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(61);
    render(<CartTotals subtotalCents={1500} bundleDiscountCents={300} labels={labels} />);

    expect(screen.getByText('€15.00')).toBeDefined();
    expect(screen.getByText('Volume discount')).toBeDefined();
    expect(screen.getByText('−€3.00')).toBeDefined();
    // 15.00 − 3.00 + 0.61
    expect(screen.getByText('€12.61')).toBeDefined();
  });

  it('computes the fee on the DISCOUNTED subtotal, not the list subtotal', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(61);
    render(<CartTotals subtotalCents={1500} bundleDiscountCents={300} labels={labels} />);

    expect(getBuyerServiceFeeCentsMock).toHaveBeenCalledWith(1200);
  });

  it('shows the discount and total even while the fee is disabled', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(0);
    render(<CartTotals subtotalCents={1500} bundleDiscountCents={300} labels={labels} />);

    expect(screen.getByText('Volume discount')).toBeDefined();
    expect(screen.queryByText('Service fee')).toBeNull();
    expect(screen.getByText('€12.00')).toBeDefined();
  });

  it('renders exactly the pre-bundle single row when nothing is discounted', () => {
    getBuyerServiceFeeCentsMock.mockReturnValue(0);
    render(<CartTotals subtotalCents={1500} bundleDiscountCents={0} labels={labels} />);

    expect(screen.queryByText('Volume discount')).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
    expect(screen.getByText('€15.00')).toBeDefined();
  });

  it('never lets a discount exceed the subtotal', () => {
    // Defensive: the component also renders optimistic client state.
    getBuyerServiceFeeCentsMock.mockReturnValue(0);
    render(<CartTotals subtotalCents={1000} bundleDiscountCents={99_999} labels={labels} />);

    expect(screen.getByText('−€10.00')).toBeDefined();
    expect(screen.getByText('€0.00')).toBeDefined();
  });
});
