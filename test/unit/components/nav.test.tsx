/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let mockPathname = '/es';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useParams: () => ({ lang: 'es' }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-auth-user', () => ({
  useAuthUser: () => ({ user: null }),
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

import { Nav } from '@/components/nav';

afterEach(() => {
  cleanup();
  mockPathname = '/es';
});

// T-114: `showCart` gates whether <CartLinkButton> mounts at all, and Nav
// stays mounted across client-side navigation (it lives in [lang]/layout.tsx).
// Before the fix, navigating between a cart surface (/events) and a
// non-cart surface (/) added/removed the button's DOM footprint entirely,
// shifting the language switcher next to it. The slot must stay reserved
// on both kinds of route.
// T-120: the signed-out "become a photographer" link must point to the
// /photographers landing (it temporarily pointed to login after T-118).
describe('Nav become-photographer link (T-120)', () => {
  it('links to the localized /photographers landing for signed-out visitors', () => {
    const { getByText } = render(<Nav />);
    const link = getByText('becomePhotographer').closest('a');
    expect(link?.getAttribute('href')).toBe('/es/photographers');
  });
});

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
