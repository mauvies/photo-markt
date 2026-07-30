/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Regression test for a display gap found in T-204.
 *
 * Ticket A made `events.bundle_all_photos_cents` — the "all photos for one price"
 * ceiling — fully WRITABLE: both event actions validate it, persist it, and the
 * editor offers a field for it. But neither read-only surface rendered it. So a
 * photographer could save "€25 for all photos", reload, and be shown a pricing
 * summary that denied it existed — and no buyer was ever shown the offer at all.
 *
 * That is the wrong-price class this feature exists to avoid, and nothing caught
 * it: the value round-trips through the DB correctly, so the persistence tests
 * pass. Only rendering catches it.
 *
 * Both surfaces are covered here because they failed for the same reason and can
 * regress independently.
 */

import { EventPricingTab } from '@/app/[lang]/dashboard/photographer/events/[id]/event-pricing-tab';
import { EventPricingSection } from '@/components/event-pricing-section';
import en from '@/dictionaries/en.json';
import type { BundleTier } from '@/lib/bundle-pricing';

afterEach(cleanup);

const t = en.bundlePricing as React.ComponentProps<typeof EventPricingTab>['t'];

/** The user's real configuration from staging: €3 a photo, 3+ €7.20, all €25. */
const TIERS: BundleTier[] = [{ minQuantity: 3, totalPriceCents: 720 }];
const UNIT_EUROS = 3;
const ALL_PHOTOS_CENTS = 2500;

const sectionLabels = {
  heading: t.heading,
  singlePhoto: t.singlePhoto,
  photosOrMore: t.photosOrMore,
  eachSuffix: t.eachSuffix,
  ladderHint: t.ladderHint,
  allPhotos: t.allPhotos,
};

function renderTab(overrides: Partial<React.ComponentProps<typeof EventPricingTab>> = {}) {
  return render(
    <EventPricingTab
      t={t}
      editLabel="Edit"
      freeLabel="Free"
      pricePerPhoto={UNIT_EUROS}
      bundleTiers={TIERS}
      bundleAllPhotosCents={ALL_PHOTOS_CENTS}
      isOrganizerEvent={false}
      editHref="/en/dashboard/photographer/events/e1/edit?section=pricing"
      {...overrides}
    />,
  );
}

describe("photographer's Pricing tab shows the all-photos price", () => {
  it('renders the ceiling as its own row', () => {
    renderTab();

    expect(screen.getByText(t.allPhotos)).toBeDefined();
    expect(screen.getByText('€25.00')).toBeDefined();
  });

  it('still renders the unit price and the rungs alongside it', () => {
    renderTab();

    expect(screen.getByText('€3.00')).toBeDefined();
    expect(screen.getByText('€7.20')).toBeDefined();
  });

  it('states where the ceiling starts being cheaper', () => {
    renderTab();

    // ceil(2500 / 300) = 9 photos.
    expect(screen.getByText(t.allPhotosBreakEven.replace('{n}', '9'))).toBeDefined();
  });

  it('does not claim "no packs yet" when only a ceiling is configured', () => {
    // A ceiling with no rungs is a complete configuration — "€3 a photo, or €25
    // for all of them" — so the empty-state copy would be a flat contradiction.
    renderTab({ bundleTiers: null });

    expect(screen.getByText('€25.00')).toBeDefined();
    expect(screen.queryByText(t.noLadder)).toBeNull();
  });

  it('keeps the empty state when nothing is configured at all', () => {
    renderTab({ bundleTiers: null, bundleAllPhotosCents: null });

    expect(screen.getByText(t.noLadder)).toBeDefined();
    expect(screen.queryByText(t.allPhotos)).toBeNull();
  });
});

describe('buyer-facing pricing section shows the all-photos price', () => {
  it('renders the ceiling as its own row', () => {
    render(
      <EventPricingSection
        pricePerPhoto={UNIT_EUROS}
        bundleTiers={TIERS}
        bundleAllPhotosCents={ALL_PHOTOS_CENTS}
        labels={sectionLabels}
      />,
    );

    expect(screen.getByText(t.allPhotos)).toBeDefined();
    expect(screen.getByText('€25.00')).toBeDefined();
  });

  it('renders the panel for a ceiling-only event, which has no rungs to show', () => {
    render(
      <EventPricingSection
        pricePerPhoto={UNIT_EUROS}
        bundleTiers={null}
        bundleAllPhotosCents={ALL_PHOTOS_CENTS}
        labels={sectionLabels}
      />,
    );

    expect(screen.getByText('€25.00')).toBeDefined();
  });

  it('renders nothing at all for an event with neither', () => {
    const { container } = render(
      <EventPricingSection
        pricePerPhoto={UNIT_EUROS}
        bundleTiers={null}
        bundleAllPhotosCents={null}
        labels={sectionLabels}
      />,
    );

    expect(container.innerHTML).toBe('');
  });
});
