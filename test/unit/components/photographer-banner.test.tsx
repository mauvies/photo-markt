/** @vitest-environment happy-dom */

import type { User } from '@supabase/supabase-js';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let mockPathname = '/es';
let mockUser: User | null | undefined = null;

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useParams: () => ({ lang: 'es' }),
}));

vi.mock('@/hooks/use-auth-user', () => ({
  useAuthUser: () => ({ user: mockUser }),
}));

import { PhotographerBanner } from '@/components/photographer-banner';

afterEach(() => {
  cleanup();
  mockPathname = '/es';
  mockUser = null;
});

describe('PhotographerBanner', () => {
  it('renders on the home page for a signed-out visitor', () => {
    mockPathname = '/es';
    mockUser = null;
    const { getByText, container } = render(<PhotographerBanner label="Soy fotógrafo" />);
    expect(getByText('Soy fotógrafo')).toBeTruthy();
    // T-120: points to the photographers landing (locale-prefixed), not login.
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/es/photographers');
  });

  it('renders nothing for an authenticated user', () => {
    mockPathname = '/es';
    mockUser = { id: 'u1' } as User;
    const { container } = render(<PhotographerBanner label="Soy fotógrafo" />);
    expect(container.firstChild).toBeNull();
  });

  // Regression: the strip sits at top:0 of the document, so rendering nothing
  // until auth resolved and then inserting it pushed the ENTIRE home page down.
  it('reserves the strip while auth is unresolved instead of collapsing', () => {
    mockPathname = '/es';
    mockUser = undefined;
    const { container, queryByText } = render(<PhotographerBanner label="Soy fotógrafo" />);
    const placeholder = container.querySelector('[data-slot="skeleton"]');
    expect(placeholder).not.toBeNull();
    // Placeholder only — no link and no label to flash at a viewer who may
    // turn out to be signed in.
    expect(container.querySelector('a')).toBeNull();
    expect(queryByText('Soy fotógrafo')).toBeNull();
  });

  it('reserves exactly the strip the resolved banner occupies', () => {
    mockPathname = '/es';
    mockUser = undefined;
    const { container: pending } = render(<PhotographerBanner label="Soy fotógrafo" />);
    const pendingStrip =
      pending.querySelector('[data-slot="skeleton"]')?.parentElement?.getAttribute('class') ?? '';
    // Same mobile-only gate, so neither state leaks onto desktop.
    expect(pending.firstElementChild?.getAttribute('class')).toBe('md:hidden');
    cleanup();

    mockUser = null;
    const { container: resolved } = render(<PhotographerBanner label="Soy fotógrafo" />);
    const resolvedStrip = resolved.querySelector('a')?.getAttribute('class') ?? '';

    // Height comes from `py-2` + the `text-sm` line box; both states must
    // declare both, or the swap reintroduces the shift this test pins.
    expect(pendingStrip).toContain('py-2');
    expect(pendingStrip).toContain('text-sm');
    expect(resolvedStrip).toContain('py-2');
    expect(resolvedStrip).toContain('text-sm');
  });

  it('renders nothing outside the home page', () => {
    mockPathname = '/es/events';
    mockUser = null;
    const { container } = render(<PhotographerBanner label="Soy fotógrafo" />);
    expect(container.firstChild).toBeNull();
  });
});
