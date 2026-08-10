/** @vitest-environment happy-dom */
/**
 * Regression: tapping the date field in the home page's search/filters sheet
 * made the open modal vanish, flashed the HOME PAGE SKELETON over the whole
 * page, then brought the modal back with the date picker open.
 *
 * Cause: `Calendar` is a `next/dynamic` import with no Suspense boundary of its
 * own, so mounting it suspended against the nearest ancestor boundary — the
 * route's `loading.tsx`. React hid the entire page behind that fallback for the
 * length of the chunk fetch.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CalendarFallback } from '@/components/event-search-bar/CalendarFallback';

afterEach(cleanup);

const SEARCH_BAR = 'src/components/event-search-bar/EventSearchBar.tsx';

describe('the code-split Calendar is contained locally', () => {
  it('wraps every Calendar render site in its own Suspense boundary', () => {
    // Comments stripped first — the invariant is documented in one of them,
    // and a mention of `<Suspense>` in prose is not a boundary.
    const src = readFileSync(join(process.cwd(), SEARCH_BAR), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const calendarSites = src.match(/<Calendar\b/g) ?? [];
    const suspenseBoundaries = src.match(/<Suspense\b/g) ?? [];

    expect(calendarSites.length).toBeGreaterThan(0);
    // One boundary per site. A site without one puts the route's loading.tsx
    // back in charge of the fallback — i.e. the page-wide flash returns.
    expect(suspenseBoundaries.length).toBe(calendarSites.length);
  });

  it('warms the chunk when a surface that can reveal the calendar opens', () => {
    const src = readFileSync(join(process.cwd(), SEARCH_BAR), 'utf8');
    // Same specifier as the dynamic import, so both resolve to one chunk.
    expect(src).toContain("void import('@/components/ui/calendar')");
    expect(src).toMatch(/if \(mobileDialogOpen \|\| filterModalOpen\) preloadCalendar\(\)/);
  });
});

describe('CalendarFallback', () => {
  it('declares its own --cell-size so its rows never collapse', () => {
    // The real calendar declares `--cell-size` on its own className, which a
    // Suspense fallback never receives. Without a default the placeholder
    // collapsed to ~75px and the card jumped 300px+ when the calendar landed.
    const { container } = render(<CalendarFallback />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('[--cell-size:--spacing(7)]');
  });

  it('reserves the caller-supplied box', () => {
    const { container } = render(<CalendarFallback className="h-[402px] w-full" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('h-[402px]');
    expect(root.className).toContain('w-full');
  });

  it('lays out a month: a caption plus a weekday row and six week rows of seven cells', () => {
    const { container } = render(<CalendarFallback />);
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    // 1 caption + 7 rows × 7 cells.
    expect(skeletons.length).toBe(1 + 7 * 7);
  });

  it('is hidden from assistive tech — it stands in for a control, not content', () => {
    const { container } = render(<CalendarFallback />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});
