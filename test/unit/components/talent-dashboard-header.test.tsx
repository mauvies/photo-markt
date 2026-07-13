/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/dashboard/talent/favorites',
  useParams: () => ({ lang: 'es' }),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock('@/hooks/use-cart-item-count', () => ({
  useCartItemCount: () => 0,
}));

// Not under test here — stub to markers, same pattern as nav.test.tsx /
// dashboard-logo-link.test.tsx (both reach into Server-Action/supabase
// modules irrelevant to this header-composition regression).
vi.mock('@/components/cart-link-button', () => ({
  CartLinkButton: () => <div data-testid="cart-link-button" />,
}));
vi.mock('@/components/dashboard-user-menu', () => ({
  DashboardUserMenu: () => <div data-testid="dashboard-user-menu" />,
}));
vi.mock('@/components/bottom-nav-account', () => ({
  BottomNavAccount: () => <div data-testid="bottom-nav-account" />,
}));

import { TalentDashboardHeader } from '@/components/talent-dashboard-header';

afterEach(cleanup);

const navLabels = {
  favorites: 'Favorites',
  orders: 'Orders',
  profile: 'Profile',
  privacy: 'Privacy',
  settings: 'Settings',
  support: 'Support',
  feedback: 'Feedback',
  activeRole: 'Role',
  switchTo: 'Switch to',
  logOut: 'Log out',
  rolePhotographer: 'Photographer',
  roleTalent: 'Talent',
  account: 'Account',
  cart: 'Cart',
};

// T-118: talentNavLinks (Explore/Favorites/Orders/Profile as desktop nav
// links + mobile bottom-nav tabs) are gone — replaced by the shared
// TalentHeaderActions pattern (desktop) and a trimmed [Favorites, Cart]
// bottom nav (mobile), with Orders/Profile moved into the account dropdown.
describe('TalentDashboardHeader (T-118 simplified nav)', () => {
  it('renders TalentHeaderActions (cart/favorites/avatar-dropdown) instead of nav links', () => {
    render(
      <TalentDashboardHeader
        user={{ name: 'Ana', email: 'ana@example.com', avatar: null }}
        activeRole="talent"
        navLabels={navLabels}
      />,
    );

    expect(screen.getByTestId('cart-link-button')).toBeTruthy();
    expect(screen.getByTestId('dashboard-user-menu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Favorites' })).toBeTruthy();
    // No standalone text nav links for Explore/Orders/Profile anymore.
    expect(screen.queryByRole('link', { name: 'Orders' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull();
    expect(screen.queryByText('Explore')).toBeNull();
  });

  it('shows only Favorites and Cart as mobile bottom-nav tabs', () => {
    render(
      <TalentDashboardHeader
        user={{ name: 'Ana', email: 'ana@example.com', avatar: null }}
        activeRole="talent"
        navLabels={navLabels}
      />,
    );

    const bottomNav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    const tabLabels = Array.from(bottomNav.querySelectorAll('a')).map((a) => a.textContent);
    expect(tabLabels).toEqual(['Favorites', 'Cart']);
    expect(screen.getByTestId('bottom-nav-account')).toBeTruthy();
  });
});
