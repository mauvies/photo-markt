/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Radix's dropdown primitive expects a few DOM APIs happy-dom doesn't ship.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  for (const fn of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(fn in Element.prototype)) {
      // biome-ignore lint/suspicious/noExplicitAny: minimal test polyfill
      (Element.prototype as any)[fn] = () => false;
    }
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
});

vi.mock('next/navigation', () => ({
  useParams: () => ({ lang: 'es' }),
  usePathname: () => '/es/events',
  useSearchParams: () => new URLSearchParams(''),
}));

import { LanguageSwitcher } from '@/components/language-switcher';

afterEach(cleanup);

function openDropdown() {
  render(<LanguageSwitcher />);
  const trigger = screen.getByRole('button', { name: 'Switch language' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  return screen.getByRole('menu');
}

describe('LanguageSwitcher (dropdown)', () => {
  it('keeps both locale links with their localized hrefs (no functional change)', () => {
    const menu = openDropdown();
    expect(
      within(menu)
        .getByRole('menuitem', { name: /English/ })
        .getAttribute('href'),
    ).toMatch(/^\/en\//);
    expect(
      within(menu)
        .getByRole('menuitem', { name: /Español/ })
        .getAttribute('href'),
    ).toMatch(/^\/es\//);
  });

  it('rounds the dropdown content to match cards (T-002 polish)', () => {
    const menu = openDropdown();
    expect(menu.className).toContain('rounded-xl');
  });

  it('shrinks the menu flags to text-xs and aligns them (T-002 polish)', () => {
    const menu = openDropdown();
    const flag = within(menu).getByText('🇪🇸');
    expect(flag.className).toContain('text-xs');
    expect(flag.className).toContain('leading-none');
  });
});
