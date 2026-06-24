/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// `Main` decides its width class from the current pathname; control it per-test.
const usePathname = vi.fn<() => string>();
vi.mock('next/navigation', () => ({ usePathname: () => usePathname() }));

import { Main } from '@/components/main';

afterEach(() => {
  cleanup();
  usePathname.mockReset();
});

function renderMainFor(pathname: string): HTMLElement {
  usePathname.mockReturnValue(pathname);
  const { container } = render(<Main>content</Main>);
  const main = container.querySelector('main');
  if (!main) throw new Error('expected a <main> element');
  return main;
}

describe('Main width class (T-043)', () => {
  // 100vw ignores the vertical scrollbar, overflowing the content box by the
  // scrollbar width — that stray horizontal overflow is what makes mobile
  // browsers render the page zoomed-in and shoves the fixed/sticky bars out of
  // place. `w-full` (100%) respects the scrollbar and never overflows.
  const paths = [
    '/es/dashboard/talent/events',
    '/en/dashboard/photographer/events/123',
    '/es/login',
    '/en/signup',
    '/es/auth/reset-password',
    '/es/events/abc123',
    '/en',
  ];

  for (const path of paths) {
    it(`never applies w-screen for ${path}`, () => {
      const main = renderMainFor(path);
      expect(main.className).not.toContain('w-screen');
      expect(main.className).toContain('w-full');
    });
  }

  it('keeps the full-height (h-dvh) layout on dashboard/auth pages', () => {
    expect(renderMainFor('/es/dashboard/talent/events').className).toContain('h-dvh');
    expect(renderMainFor('/en/login').className).toContain('h-dvh');
    // Public pages stay auto-height (no h-dvh) so the footer flows after content.
    expect(renderMainFor('/en/events/abc123').className).not.toContain('h-dvh');
  });
});
