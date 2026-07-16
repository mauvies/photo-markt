import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { ADDED_TO_CART_TOAST_ID, showAddedToCartToast } from '@/lib/cart-toast';

describe('showAddedToCartToast', () => {
  beforeEach(() => {
    toastMock.success.mockClear();
  });

  it('fires a success toast with the stable id and a working View cart action', () => {
    const onViewCart = vi.fn();
    showAddedToCartToast({
      message: 'Added to cart',
      viewCartLabel: 'View cart',
      onViewCart,
    });

    expect(toastMock.success).toHaveBeenCalledTimes(1);
    const [message, options] = toastMock.success.mock.calls[0];
    expect(message).toBe('Added to cart');
    // Stable id → rapid re-adds replace (not stack) the toast, and the
    // replacement always carries a fresh onViewCart closure.
    expect(options.id).toBe(ADDED_TO_CART_TOAST_ID);
    expect(options.action.label).toBe('View cart');

    // The action navigates via the supplied closure (never a stale handler).
    expect(onViewCart).not.toHaveBeenCalled();
    options.action.onClick();
    expect(onViewCart).toHaveBeenCalledTimes(1);
  });
});
