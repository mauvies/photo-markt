/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Both logos derive their locale from useParams(); pin it to 'es'.
vi.mock('next/navigation', () => ({
  useParams: () => ({ lang: 'es' }),
  usePathname: () => '/es/dashboard/photographer/events/abc',
}));

// Sidebar primitives depend on browser APIs we don't need here — stub to
// lightweight pass-throughs so the header/link render in happy-dom.
vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The nav lists aren't under test — stub them so AppSidebar renders without a
// SidebarProvider context.
vi.mock('@/components/nav-main', () => ({ NavMains: () => null }));
vi.mock('@/components/nav-secondary', () => ({ NavSecondary: () => null }));

// The talent header's cart/account children reach into Server-Action modules
// (supabase-admin → server-only env). Stub them: this test only asserts the
// logo href, not the cart/menu behaviour.
vi.mock('@/components/cart-link-button', () => ({ CartLinkButton: () => null }));
vi.mock('@/components/dashboard-user-menu', () => ({ DashboardUserMenu: () => null }));
vi.mock('@/components/bottom-nav', () => ({ BottomNav: () => null }));
vi.mock('@/components/bottom-nav-account', () => ({ BottomNavAccount: () => null }));
vi.mock('@/hooks/use-cart-item-count', () => ({ useCartItemCount: () => 0 }));

import { AppSidebar } from '@/components/app-sidebar';
import { TalentDashboardHeader } from '@/components/talent-dashboard-header';

afterEach(cleanup);

const photographerLabels = {
  overview: 'Overview',
  createEvent: 'Create',
  events: 'Events',
  revenue: 'Revenue',
  myPhotos: 'My photos',
  profile: 'Profile',
  explore: 'Explore',
  orders: 'Orders',
  support: 'Support',
  feedback: 'Feedback',
};

const talentLabels = {
  explore: 'Explore',
  myPhotos: 'My photos',
  orders: 'Orders',
  profile: 'Profile',
  privacy: 'Privacy',
  settings: 'Settings',
  billing: 'Billing',
  support: 'Support',
  feedback: 'Feedback',
  activeRole: 'Active role',
  switchTo: 'Switch to',
  logOut: 'Log out',
  rolePhotographer: 'Photographer',
  roleTalent: 'Talent',
  account: 'Account',
  cart: 'Cart',
};

describe('dashboard logo link (T-061)', () => {
  it('photographer sidebar logo points at the photographer overview, not home', () => {
    render(<AppSidebar activeRole="photographer" navLabels={photographerLabels} />);
    const logo = screen.getByRole('img', { name: 'Photo Markt' }).closest('a');
    expect(logo?.getAttribute('href')).toBe('/es/dashboard/photographer');
  });

  it('talent header logo points at the talent dashboard, not home', () => {
    render(
      <TalentDashboardHeader
        user={{ name: 'Ana', email: 'ana@example.com', avatar: null }}
        activeRole="talent"
        navLabels={talentLabels}
      />,
    );
    const logo = screen.getByRole('img', { name: 'Photo Markt' }).closest('a');
    expect(logo?.getAttribute('href')).toBe('/es/dashboard/talent');
  });
});
