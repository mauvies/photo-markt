/** @vitest-environment happy-dom */
/**
 * Regression tests for FindMyPhotosBanner's bib search (T-081): the bib input
 * moved from an inline form (which changed the card's height and pushed the
 * gallery down) into a modal dialog. These pin that the input only appears
 * inside a dialog after clicking the bib button, and that an active bib search
 * still has a reachable Clear affordance in the banner.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The banner imports a server action + sonner; stub both so the client
// component renders in happy-dom without pulling server-only code.
vi.mock('@/app/[lang]/events/[shareCode]/actions', () => ({
  searchPhotosByBibInEvent: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

import { FindMyPhotosBanner, type FindMyPhotosLabels } from '@/components/find-my-photos-banner';

const labels: FindMyPhotosLabels = {
  title: 'Find your photos',
  titleIndexing: 'Processing photos…',
  descriptionFace: 'FACE',
  descriptionBib: 'BIB',
  descriptionBoth: 'BOTH',
  descriptionIndexing: 'INDEXING',
  faceButton: 'Face search',
  bibButton: 'Bib search',
  bibModalTitle: 'Search by bib number',
  bibModalDescription: 'Enter your bib number',
  bibPlaceholder: 'Enter a bib number',
  bibSearch: 'Search',
  bibCancel: 'Cancel',
  bibClear: 'Clear',
  bibFailed: 'Bib search failed',
};

afterEach(cleanup);

describe('FindMyPhotosBanner — bib search modal (T-081)', () => {
  it('keeps the bib input out of the card and only shows it in a modal after clicking the button', () => {
    render(
      <FindMyPhotosBanner
        labels={labels}
        bib={{ shareCode: 'ABC', onResults: vi.fn(), hasResults: false }}
      />,
    );

    // No inline input and no dialog before the button is clicked.
    expect(screen.queryByPlaceholderText('Enter a bib number')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bib search' }));

    // The input now lives inside a modal dialog — not inline in the card.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter a bib number')).toBeTruthy();
  });

  it('offers a Clear affordance in the banner while a bib search is active', () => {
    const onResults = vi.fn();
    render(
      <FindMyPhotosBanner
        labels={labels}
        bib={{ shareCode: 'ABC', onResults, hasResults: true }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onResults).toHaveBeenCalledWith(null);
  });
});
