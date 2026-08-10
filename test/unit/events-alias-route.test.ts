import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-157: `/events` became an ALIAS of the home explore
 * experience rather than a separate hero-less listing. Source-level assertions
 * (the repo's routing/layout test pattern — cf. T-127/T-156/T-158) pin the
 * decision so it can't silently drift; the behavioral half (sitemap no longer
 * lists the bare `/events`) lives in `sitemap.test.ts`.
 */

const root = process.cwd();

/** The index route lives in the `(index)` route group so its `loading.tsx`
 *  can't stand in for `/events/[shareCode]`. The group is invisible in the
 *  URL — `/events` is unchanged. */
function readPage(): string {
  return readFileSync(resolve(root, 'src/app/[lang]/events/(index)/page.tsx'), 'utf8');
}

describe('/events alias route (T-157)', () => {
  it('renders the shared EventsExploreView (same as the home), not the bare listing', () => {
    const src = readPage();
    expect(src).toContain('EventsExploreView');
    // The old page rendered ExplorePageContent directly (no hero).
    expect(src).not.toContain('ExplorePageContent');
  });

  it('redirects authenticated users to the talent explore surface', () => {
    const src = readPage();
    expect(src).toContain('getUser');
    expect(src).toContain('localizedRedirect');
    expect(src).toContain('/dashboard/talent/events');
  });

  it('sets rel=canonical to the home so /events is not treated as duplicate content', () => {
    const src = readPage();
    expect(src).toContain('generateMetadata');
    expect(src).toContain('canonical');
  });

  it('keeps the search bar on /events (basePath) and drops the ?status filter', () => {
    const src = readPage();
    // basePath routes back to /events (vs the home's bare `/${lang}`), so a
    // search from here stays on /events. Matched via regex to avoid embedding a
    // literal `${...}` template placeholder in a plain string.
    expect(src).toMatch(/basePath=\{`\/\$\{lang}\/events`}/);
    // The removed `?status=` plumbing pulled in these helpers — they must be gone.
    expect(src).not.toContain('getTodayISOString');
    expect(src).not.toContain('validStatus');
  });
});
