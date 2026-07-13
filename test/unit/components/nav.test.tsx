/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let mockPathname = '/es';
let mockUser: { email: string; user_metadata?: Record<string, unknown> } | null = null;
let mockActiveRole: 'talent' | 'photographer' | undefined;

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useParams: () => ({ lang: 'es' }),
  useSearchParams: () => new URLSearchParams(),
  // UserAvatar (the photographer/no-role branch) calls useRouter for its
  // "go to dashboard"/logout navigation — not exercised by these tests.
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock('@/hooks/use-auth-user', () => ({
  useAuthUser: () => ({ user: mockUser }),
}));

// T-118: Nav also reads the active role client-side (react-query-backed) to
// decide whether to render the talent header actions.
vi.mock('@/hooks/use-active-role', () => ({
  useActiveRole: () => ({ activeRole: mockActiveRole }),
}));

vi.mock('@/lib/i18n/translations-provider', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}));

// The cart button's own internals (react-query/localStorage) aren't under
// test here — stub it to a marker so we can assert on mount/unmount only.
vi.mock('@/components/cart-link-button', () => ({
  CartLinkButton: () => <div data-testid="cart-link-button" />,
}));

vi.mock('@/components/language-switcher', () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}));

// DashboardUserMenu reaches into Server-Action/supabase-client modules not
// relevant to these tests — stub it to a marker, same pattern as
// dashboard-logo-link.test.tsx.
vi.mock('@/components/dashboard-user-menu', () => ({
  DashboardUserMenu: () => <div data-testid="dashboard-user-menu" />,
}));

import { Nav } from '@/components/nav';

afterEach(() => {
  cleanup();
  mockPathname = '/es';
  mockUser = null;
  mockActiveRole = undefined;
});

// T-114: `showCart` gates whether <CartLinkButton> mounts at all, and Nav
// stays mounted across client-side navigation (it lives in [lang]/layout.tsx).
// Before the fix, navigating between a cart surface (/events) and a
// non-cart surface (/) added/removed the button's DOM footprint entirely,
// shifting the language switcher next to it. The slot must stay reserved
// on both kinds of route.
describe('Nav cart slot (T-114 layout-shift regression)', () => {
  it('reserves the same-size cart slot on a non-cart route as on a cart route', () => {
    mockPathname = '/es';
    const { container: homeContainer } = render(<Nav />);
    const homeSlot = homeContainer.querySelector(
      '[data-testid="language-switcher"]',
    )?.previousElementSibling;
    expect(homeSlot).toBeTruthy();
    expect(homeSlot?.className).toContain('h-10');
    expect(homeSlot?.className).toContain('w-10');
    expect(homeContainer.querySelector('[data-testid="cart-link-button"]')).toBeNull();
    cleanup();

    mockPathname = '/es/events';
    const { container: eventsContainer } = render(<Nav />);
    const eventsSlot = eventsContainer.querySelector(
      '[data-testid="language-switcher"]',
    )?.previousElementSibling;
    // Same wrapper footprint on both routes — only its contents differ.
    expect(eventsSlot?.className).toBe(homeSlot?.className);
    expect(eventsContainer.querySelector('[data-testid="cart-link-button"]')).toBeTruthy();
  });
});

// T-118: an authenticated talent gets the shared header-actions pattern
// (cart/favorites/avatar-dropdown) everywhere Nav renders — including `/` —
// instead of the plain avatar / Login-Sign up branch.
describe('Nav talent header (T-118)', () => {
  it('renders cart + favorites + avatar dropdown for an authenticated talent, with no Login/Sign up', () => {
    mockPathname = '/es';
    mockUser = { email: 'talent@example.com', user_metadata: {} };
    mockActiveRole = 'talent';

    render(<Nav />);

    expect(screen.getByTestId('cart-link-button')).toBeTruthy();
    expect(screen.getByTestId('dashboard-user-menu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'favorites' })).toBeTruthy();
    expect(screen.queryByText('login')).toBeNull();
    expect(screen.queryByText('getStarted')).toBeNull();
  });

  it('keeps the plain avatar / Login-Sign up branch for a photographer (unaffected by T-118)', () => {
    mockPathname = '/es';
    mockUser = { email: 'photographer@example.com', user_metadata: {} };
    mockActiveRole = 'photographer';

    render(<Nav />);

    expect(screen.queryByTestId('dashboard-user-menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'favorites' })).toBeNull();
  });

  it('keeps the anonymous Login/Sign up branch when there is no user', () => {
    mockPathname = '/es';
    mockUser = null;
    mockActiveRole = undefined;

    render(<Nav />);

    expect(screen.queryByTestId('dashboard-user-menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'favorites' })).toBeNull();
  });
});
