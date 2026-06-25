import { describe, expect, it } from 'vitest';
import { cartView } from '@/lib/cart-view';

describe('cartView (T-039)', () => {
  it('shows the merge skeleton even when the cart already has items', () => {
    // The regression: before the fix the empty-state check ran first and the
    // merge skeleton only gated the empty branch, so a cart that already had
    // items painted immediately and the guest items popped in on top. Merging
    // must take priority over a non-empty cart.
    expect(cartView(true, 3)).toBe('merging');
  });

  it('shows the merge skeleton over an empty cart', () => {
    expect(cartView(true, 0)).toBe('merging');
  });

  it('shows the empty state when not merging and the cart is empty', () => {
    expect(cartView(false, 0)).toBe('empty');
  });

  it('shows the list when not merging and the cart has items', () => {
    expect(cartView(false, 2)).toBe('list');
  });
});
