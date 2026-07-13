/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

vi.mock('@/app/[lang]/dashboard/talent/events/actions', () => ({
  getFilterOptionsAction: vi.fn(async () => ({
    cities: [],
    countries: [],
    activities: [],
  })),
}));

// The event search/filter/pagination grid isn't under test here — it's the
// same `ExplorePageContent` `/events` already uses. What T-118 changes is
// which section renders on `/`, not that component's own behavior.
vi.mock('@/app/[lang]/dashboard/talent/events/explore-page-content', () => ({
  ExplorePageContent: () => <div data-testid="explore-page-content" />,
}));

import Home from '@/app/[lang]/page';

afterEach(cleanup);

// T-118: the landing dropped pricing/"How It Works"/final-CTA and the
// top-events-only teaser (`FeaturedEvents`) in favor of a compact hero +
// the same paginated event grid `/events` uses.
describe('Home (landing) page (T-118)', () => {
  it('renders the compact hero and the paginated explore grid, not FeaturedEvents/pricing/how-it-works/CTA', async () => {
    const jsx = await Home({ params: Promise.resolve({ lang: 'es' }) });
    render(jsx);

    // Hero title still renders (compact hero keeps the headline).
    expect(screen.getByText('Tus Mejores Fotos')).toBeTruthy();
    // The old descriptive subtitle is gone — its dictionary key no longer
    // exists at all (removed alongside this section).
    expect(screen.queryByText(/Conectamos fotógrafos con talentos/)).toBeNull();

    // Paginated grid (ExplorePageContent), not the top-events-only teaser.
    expect(screen.getByTestId('explore-page-content')).toBeTruthy();

    // Pricing / "How It Works" / final-CTA copy no longer renders.
    expect(screen.queryByText('Cómo funciona')).toBeNull();
    expect(screen.queryByText(/¿Listo para ver tus eventos con nueva luz\?/)).toBeNull();
  });
});
