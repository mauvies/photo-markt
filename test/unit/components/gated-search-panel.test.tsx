/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-230: the screen a reveal-gated event (T-177) shows before the visitor has
 * searched. That screen IS the product — the gallery is not browsable by
 * design, so a visitor who doesn't search sees nothing and buys nothing. It used
 * to be one muted line inside the gallery slot whose copy had to point at a
 * button somewhere above it ("take a selfie above"), which is the tell that the
 * call to action was in the wrong place.
 *
 * These pin the two properties that fix costs nothing to lose by accident: the
 * CTA lives INSIDE the panel, and all three pre-search states render as the same
 * panel rather than one loud state and two mute paragraphs.
 */

import { GatedSearchPanel } from '@/components/gated-search-panel';

afterEach(cleanup);

const labels = {
  searchTitle: 'Find your photos',
  searchDescription: 'This event’s gallery isn’t public.',
  searchCta: 'Search my photos',
  photoCount: '{count} photos in this event',
  privacyNote: 'Your selfie is never stored.',
  processingTitle: 'Photos are being processed',
  processingDescription: 'Still preparing.',
  unavailableTitle: 'Face search isn’t available',
  unavailableDescription: 'Not available right now.',
};

describe('GatedSearchPanel', () => {
  it('owns the search CTA itself, so the copy never points somewhere else', async () => {
    const onSearch = vi.fn();
    render(
      <GatedSearchPanel state="searchable" labels={labels} photoCount={42} onSearch={onSearch} />,
    );

    expect(screen.getByText('Find your photos')).toBeDefined();
    expect(screen.getByText(labels.searchDescription)).toBeDefined();
    expect(screen.getByText(labels.privacyNote)).toBeDefined();

    const cta = screen.getByRole('button', { name: /search my photos/i });
    cta.click();
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('anchors on the event total — the one fact that makes searching worth it', () => {
    render(<GatedSearchPanel state="searchable" labels={labels} photoCount={42} />);

    expect(screen.getByText('42 photos in this event')).toBeDefined();
  });

  it('keeps the count in the processing state (it is what makes waiting worth it)', () => {
    render(<GatedSearchPanel state="processing" labels={labels} photoCount={42} />);

    expect(screen.getByText('42 photos in this event')).toBeDefined();
  });

  it('drops the count line when the total is unknown or zero', () => {
    const { container } = render(<GatedSearchPanel state="searchable" labels={labels} />);
    expect(container.textContent).not.toContain('photos in this event');

    cleanup();
    const zero = render(
      <GatedSearchPanel state="searchable" labels={labels} photoCount={0} />,
    ).container;
    expect(zero.textContent).not.toContain('photos in this event');
  });

  for (const state of ['processing', 'unavailable'] as const) {
    it(`renders the ${state} state as the same panel, with no CTA to offer`, () => {
      const title = state === 'processing' ? labels.processingTitle : labels.unavailableTitle;
      const description =
        state === 'processing' ? labels.processingDescription : labels.unavailableDescription;
      render(<GatedSearchPanel state={state} labels={labels} photoCount={42} onSearch={vi.fn()} />);

      expect(screen.getByText(title)).toBeDefined();
      expect(screen.getByText(description)).toBeDefined();
      // No searchable index yet — a button that can only fail would be worse
      // than none, and the visitor must not be told to search.
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByText(labels.searchTitle)).toBeNull();
    });
  }
});
