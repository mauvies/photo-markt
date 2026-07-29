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
