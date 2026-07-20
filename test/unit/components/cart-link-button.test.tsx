/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let mockCartItemCount = 0;
let mockGuestItemCount = 0;

vi.mock('@/hooks/use-cart-item-count', () => ({
  useCartItemCount: () => mockCartItemCount,
}));

vi.mock('@/components/guest-cart-provider', () => ({
  useGuestCart: () => ({ itemCount: mockGuestItemCount }),
}));

// The active locale comes from the [lang] route param — mock it so
// useLocalizedPath resolves the prefix (T-161).
vi.mock('next/navigation', () => ({
  useParams: () => ({ lang: 'es' }),
}));

import { CartLinkButton } from '@/components/cart-link-button';

afterEach(() => {
  cleanup();
  mockCartItemCount = 0;
  mockGuestItemCount = 0;
});

// T-114: the cart icon used to `return null` on an empty cart, so the slot
// only entered the DOM once the count resolved to > 0 (async fetch for
// auth, localStorage hydration for guests) — collapsing/expanding the
// header's flex row and shifting the language switcher/avatar next to it.
// The slot must now always occupy the same footprint.
describe('CartLinkButton (T-114 layout-shift regression)', () => {
  it('reserves the same-size slot for an empty auth cart as a non-empty one', () => {
    mockCartItemCount = 0;
    const { container: emptyContainer } = render(<CartLinkButton />);
    const emptySlot = emptyContainer.firstElementChild;
    expect(emptySlot).toBeTruthy();
    expect(emptySlot?.className).toContain('h-10');
    expect(emptySlot?.className).toContain('w-10');
    // Empty cart: no link rendered inside the reserved slot.
    expect(screen.queryByRole('button', { name: /shopping cart/i })).toBeNull();
    cleanup();

    mockCartItemCount = 3;
    const { container: filledContainer } = render(<CartLinkButton />);
    const filledSlot = filledContainer.firstElementChild;
    // Same wrapper footprint — only its contents differ.
    expect(filledSlot?.className).toBe(emptySlot?.className);
    expect(screen.getByRole('button', { name: /shopping cart/i })).toBeTruthy();
  });

  it('reserves the same-size slot for an empty guest cart as a non-empty one', () => {
    mockGuestItemCount = 0;
    const { container: emptyContainer } = render(<CartLinkButton guest />);
    const emptySlot = emptyContainer.firstElementChild;
    expect(screen.queryByRole('button', { name: /shopping cart/i })).toBeNull();
    cleanup();

    mockGuestItemCount = 2;
    const { container: filledContainer } = render(<CartLinkButton guest />);
    const filledSlot = filledContainer.firstElementChild;
    expect(filledSlot?.className).toBe(emptySlot?.className);
    expect(screen.getByRole('button', { name: /shopping cart/i })).toBeTruthy();
  });
});

// T-161: the cart link (and ~20 other in-app links) dropped the `/[lang]`
// prefix, so the middleware re-detected the locale from `accept-language` and
// flipped es→en on navigation. The href must carry the active locale.
describe('CartLinkButton (T-161 locale prefix)', () => {
  it('prefixes the auth cart link with the active locale', () => {
    mockCartItemCount = 2;
    render(<CartLinkButton />);
    const link = screen.getByRole('button', { name: /shopping cart/i }).closest('a');
    // Before the fix this was the bare `/dashboard/talent/cart`.
    expect(link?.getAttribute('href')).toBe('/es/dashboard/talent/cart');
  });

  it('prefixes the guest cart link with the active locale', () => {
    mockGuestItemCount = 2;
    render(<CartLinkButton guest />);
    const link = screen.getByRole('button', { name: /shopping cart/i }).closest('a');
    // Before the fix this was the bare `/cart`.
    expect(link?.getAttribute('href')).toBe('/es/cart');
  });
});
