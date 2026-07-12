/** @vitest-environment happy-dom */
/**
 * T-101 — add-to-cart button must not fire a global `router.refresh()`.
 *
 * The cart badge is kept in sync purely via the `['cart-count']` React Query
 * invalidation; the button's own "in cart" state is local. The old handlers
 * ALSO called `router.refresh()` on every add/remove, re-rendering the whole
 * server-component subtree on a hot path. Regression: refresh must never fire
 * while the badge invalidation and the local state toggle still do.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const invalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const addPhotoToCartAction = vi.fn(async (_id: string) => {});
const removePhotoFromCartAction = vi.fn(async (_id: string) => {});
vi.mock('@/app/[lang]/dashboard/talent/cart/actions', () => ({
  addPhotoToCartAction: (id: string) => addPhotoToCartAction(id),
  removePhotoFromCartAction: (id: string) => removePhotoFromCartAction(id),
}));

import { AddToCartButton } from '@/components/add-to-cart-button';

afterEach(() => {
  cleanup();
  refresh.mockClear();
  invalidateQueries.mockClear();
  addPhotoToCartAction.mockClear();
  removePhotoFromCartAction.mockClear();
});

describe('AddToCartButton', () => {
  it('add: toggles to "In cart" and invalidates the cart-count badge', async () => {
    render(<AddToCartButton photoId="p1" />);

    fireEvent.click(screen.getByText('Add to cart'));

    await waitFor(() => expect(screen.getByText('In cart')).toBeTruthy());
    expect(addPhotoToCartAction).toHaveBeenCalledWith('p1');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['cart-count'] });
  });

  it('remove: toggles back to "Add to cart" and invalidates the badge', async () => {
    render(<AddToCartButton photoId="p1" initialInCart />);

    fireEvent.click(screen.getByText('In cart'));

    await waitFor(() => expect(screen.getByText('Add to cart')).toBeTruthy());
    expect(removePhotoFromCartAction).toHaveBeenCalledWith('p1');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['cart-count'] });
  });

  it('does NOT trigger a global router.refresh() on add', async () => {
    render(<AddToCartButton photoId="p1" />);

    fireEvent.click(screen.getByText('Add to cart'));

    await waitFor(() => expect(screen.getByText('In cart')).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does NOT trigger a global router.refresh() on remove', async () => {
    render(<AddToCartButton photoId="p1" initialInCart />);

    fireEvent.click(screen.getByText('In cart'));

    await waitFor(() => expect(screen.getByText('Add to cart')).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
