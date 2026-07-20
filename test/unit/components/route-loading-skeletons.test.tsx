/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import HomeLoading from '@/app/[lang]/(home)/loading';
import TalentEventDetailLoading from '@/app/[lang]/dashboard/talent/events/[id]/loading';
import TalentEventsLoading from '@/app/[lang]/dashboard/talent/events/loading';
import EventDetailLoading from '@/app/[lang]/events/[shareCode]/loading';
import EventsListingLoading from '@/app/[lang]/events/loading';
import RootLangLoading from '@/app/[lang]/loading';

afterEach(cleanup);

// Regression (T-128): these loading states used to be a bare <Spinner /> (or,
// for the event-detail grid, a stale 3-breakpoint/gap-4 grid) that didn't
// match the real page's footprint — causing a visible layout shift once the
// real content mounted.
//
// Regression (T-156): the home page and talent explore page share
// `EventsExploreView`, which renders a hero (title + subtitle) and a
// "Latest events" heading above the card grid — T-128's skeletons omitted
// both, so those blocks still shifted on load. The home page also had no
// `loading.tsx` at all.

describe('/events loading.tsx (T-157: now mirrors the home)', () => {
  it('matches the home shell exactly — /events became an alias of the home explore view', () => {
    const { container } = render(<EventsListingLoading />);
    // Same wrapper the home loading uses (T-156), not the old bar+grid shell.
    expect(container.innerHTML).toContain(
      'mx-auto w-full max-w-[1300px] px-4 pb-10 pt-4 sm:pt-6 sm:px-6 lg:px-8',
    );
    // Full EventsExploreView skeleton: hero (sm:h-12/sm:h-6), heading (sm:h-7), grid.
    expect(container.innerHTML).toContain('sm:h-12');
    expect(container.innerHTML).toContain('sm:h-7');
    expect(container.innerHTML).toContain('aspect-[4/3]');
    // No bare <Spinner /> (an <output> element).
    expect(container.querySelector('output')).toBeNull();
  });
});

describe('/[lang]/(home) loading.tsx (T-156; scoped to the (home) group in T-171)', () => {
  it('matches the page shell margins, the hero + heading placeholders, and the real card grid', () => {
    const { container } = render(<HomeLoading />);
    expect(container.innerHTML).toContain(
      'mx-auto w-full max-w-[1300px] px-4 pb-10 pt-4 sm:pt-6 sm:px-6 lg:px-8',
    );
    // Hero title + subtitle placeholders (previously omitted entirely).
    expect(container.innerHTML).toContain('sm:h-12');
    expect(container.innerHTML).toContain('sm:h-6');
    // "Latest events" heading placeholder.
    expect(container.innerHTML).toContain('sm:h-7');
    expect(container.innerHTML).toContain('aspect-[4/3]');
  });
});

// T-171: the home's EventsExploreView card-grid skeleton used to live at
// `[lang]/loading.tsx` — the Suspense fallback for the WHOLE `[lang]/*` subtree,
// so any async route without its own loading.tsx (photographer/[slug],
// photographers, cart, checkout, onboarding, download, dashboard root) inherited
// the home skeleton. The home now owns it inside the `(home)` route group, and
// the root `[lang]/loading.tsx` is a neutral spinner safety-net.
describe('/[lang] root loading.tsx is neutral (T-171)', () => {
  it('renders a plain spinner, never the home card-grid skeleton', () => {
    const { container } = render(<RootLangLoading />);
    // A bare <Spinner /> is an <output> element with a "Loading" sr-only label.
    expect(container.querySelector('output')).not.toBeNull();
    // None of the home-skeleton fingerprints leak into non-home routes.
    expect(container.innerHTML).not.toContain('aspect-[4/3]');
    expect(container.innerHTML).not.toContain('max-w-[1300px]');
    expect(container.innerHTML).not.toContain('sm:h-12');
  });
});

describe('/dashboard/talent/events loading.tsx', () => {
  it('renders the real card grid without re-wrapping the layout margins', () => {
    const { container } = render(<TalentEventsLoading />);
    expect(container.innerHTML).toContain('aspect-[4/3]');
    // The dashboard layout already supplies mx-auto/max-w/px — this file
    // must not duplicate it.
    expect(container.innerHTML).not.toContain('max-w-[1300px]');
  });

  it('renders the hero + "Latest events" heading placeholders (T-156: previously omitted)', () => {
    const { container } = render(<TalentEventsLoading />);
    expect(container.innerHTML).toContain('sm:h-12');
    expect(container.innerHTML).toContain('sm:h-6');
    expect(container.innerHTML).toContain('sm:h-7');
  });
});

describe('/events/[shareCode] loading.tsx', () => {
  it('matches the real photo grid columns/gap/aspect-ratio (PhotoAlbumViewer)', () => {
    const { container } = render(<EventDetailLoading />);
    expect(container.innerHTML).toContain('mx-auto max-w-[1300px] w-full flex-1 px-3 py-4');
    expect(container.innerHTML).toContain(
      'grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
    );
    expect(container.innerHTML).toContain('aspect-square');
  });
});

describe('/dashboard/talent/events/[id] loading.tsx (T-128: previously missing)', () => {
  it('matches the real photo grid columns/gap/aspect-ratio', () => {
    const { container } = render(<TalentEventDetailLoading />);
    expect(container.innerHTML).toContain(
      'grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
    );
    expect(container.innerHTML).toContain('aspect-square');
  });
});
