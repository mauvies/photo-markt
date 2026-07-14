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
    // Temporarily links to login (locale-prefixed) while the landing is improved.
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/es/login');
  });

  it('renders nothing for an authenticated user', () => {
    mockPathname = '/es';
    mockUser = { id: 'u1' } as User;
    const { container } = render(<PhotographerBanner label="Soy fotógrafo" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing while auth is unresolved', () => {
    mockPathname = '/es';
    mockUser = undefined;
    const { container } = render(<PhotographerBanner label="Soy fotógrafo" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing outside the home page', () => {
    mockPathname = '/es/events';
    mockUser = null;
    const { container } = render(<PhotographerBanner label="Soy fotógrafo" />);
    expect(container.firstChild).toBeNull();
  });
});
