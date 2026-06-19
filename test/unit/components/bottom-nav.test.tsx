/** @vitest-environment happy-dom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { Heart, Search, ShoppingCart } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/dashboard/talent/events',
}));

import { BottomNav, type BottomNavItem } from '@/components/bottom-nav';

afterEach(cleanup);

const items: BottomNavItem[] = [
  { href: '/es/dashboard/talent/events', label: 'Explore', icon: Search },
  { href: '/es/dashboard/talent/favorites', label: 'Favorites', icon: Heart },
  {
    href: '/es/dashboard/talent/cart',
    label: 'Cart',
    icon: ShoppingCart,
    badge: <span data-testid="cart-badge">3</span>,
  },
];

describe('BottomNav', () => {
  it('renders the cart tab with its count badge (T-006)', () => {
    render(<BottomNav items={items} />);
    const cartLink = screen.getByRole('link', { name: /Cart/ });
    expect(cartLink.getAttribute('href')).toBe('/es/dashboard/talent/cart');
    // The badge renders over the cart icon, not on the other tabs.
    expect(within(cartLink).getByTestId('cart-badge').textContent).toBe('3');
    expect(screen.getByRole('link', { name: /Explore/ }).querySelector('[data-testid]')).toBeNull();
  });

  it('renders an optional account slot after the items', () => {
    render(<BottomNav items={items} account={<div data-testid="account">acct</div>} />);
    expect(screen.getByTestId('account')).toBeTruthy();
  });
});
