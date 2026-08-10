import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

import {
  ADDED_TO_CART_TOAST_ID,
  resetAddedToCartToastState,
  showAddedToCartToast,
} from '@/lib/cart-toast';

function add(message = 'Added to cart', onViewCart = vi.fn()) {
  showAddedToCartToast({ message, viewCartLabel: 'View cart', onViewCart });
  return onViewCart;
}

describe('showAddedToCartToast', () => {
  beforeEach(() => {
    toastMock.success.mockClear();
    toastMock.dismiss.mockClear();
    resetAddedToCartToastState();
  });

  it('fires a success toast with a working View cart action', () => {
    const onViewCart = add();

    expect(toastMock.success).toHaveBeenCalledTimes(1);
    const [message, options] = toastMock.success.mock.calls[0];
    expect(message).toBe('Added to cart');
    expect(String(options.id).startsWith(ADDED_TO_CART_TOAST_ID)).toBe(true);
    expect(options.action.label).toBe('View cart');

    // The action navigates via the supplied closure (never a stale handler).
    expect(onViewCart).not.toHaveBeenCalled();
    options.action.onClick();
    expect(onViewCart).toHaveBeenCalledTimes(1);
  });

  // Regression: every add reused ONE stable id with identical copy, so adding a
  // second photo re-rendered the same words in the same box. Nothing moved, and
  // the buyer had no signal that the second add had registered at all.
  it('raises a distinct toast for each add so the second one is visible', () => {
    add();
    add();

    expect(toastMock.success).toHaveBeenCalledTimes(2);
    const firstId = toastMock.success.mock.calls[0][1].id;
    const secondId = toastMock.success.mock.calls[1][1].id;
    expect(secondId).not.toBe(firstId);
  });

  it('dismisses the previous toast so adds never stack up', () => {
    add();
    const firstId = toastMock.success.mock.calls[0][1].id;
    expect(toastMock.dismiss).not.toHaveBeenCalled();

    add();
    expect(toastMock.dismiss).toHaveBeenCalledTimes(1);
    expect(toastMock.dismiss).toHaveBeenCalledWith(firstId);
  });

  it('carries a fresh onViewCart closure on every add', () => {
    const first = add('Added to cart', vi.fn());
    const second = add('Added to cart', vi.fn());

    toastMock.success.mock.calls[1][1].action.onClick();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('does not try to dismiss a toast that already closed itself', () => {
    add();
    // Sonner reports the close; the next add has nothing to dismiss.
    toastMock.success.mock.calls[0][1].onAutoClose();

    add();
    expect(toastMock.dismiss).not.toHaveBeenCalled();
  });
});
