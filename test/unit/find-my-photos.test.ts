/**
 * Unit tests for `resolveFindMyPhotos` — the visibility logic behind the
 * unified "Find my photos" section (T-065).
 *
 * The section merged the separate face-search and bib-search cards into one
 * card with a button per enabled capability. These pin which buttons show for
 * each flag combination, and that an active face search hides the whole
 * section (the grid is showing bucketed results).
 */

import { describe, expect, it } from 'vitest';
import {
  resolveEventGalleryView,
  resolveFindMyPhotos,
  resolveFindMyPhotosCopy,
  resolveGatedFaceSearchNotice,
} from '@/lib/find-my-photos';

describe('resolveFindMyPhotos', () => {
  it('shows both buttons when face and bib are enabled', () => {
    expect(
      resolveFindMyPhotos({
        faceSearchActive: false,
        aiSearchEligible: true,
        bibDetectionEnabled: true,
      }),
    ).toEqual({ visible: true, showFace: true, showBib: true });
  });

  it('shows only the face button when only face is enabled', () => {
    expect(
      resolveFindMyPhotos({
        faceSearchActive: false,
        aiSearchEligible: true,
        bibDetectionEnabled: false,
      }),
    ).toEqual({ visible: true, showFace: true, showBib: false });
  });

  it('shows only the bib button when only bib is enabled', () => {
    expect(
      resolveFindMyPhotos({
        faceSearchActive: false,
        aiSearchEligible: false,
        bibDetectionEnabled: true,
      }),
    ).toEqual({ visible: true, showFace: false, showBib: true });
  });

  it('hides the section entirely when neither capability is enabled', () => {
    expect(
      resolveFindMyPhotos({
        faceSearchActive: false,
        aiSearchEligible: false,
        bibDetectionEnabled: false,
      }),
    ).toEqual({ visible: false, showFace: false, showBib: false });
  });

  it('hides the section while a face search is active, even if both flags are on', () => {
    expect(
      resolveFindMyPhotos({
        faceSearchActive: true,
        aiSearchEligible: true,
        bibDetectionEnabled: true,
      }),
    ).toEqual({ visible: false, showFace: false, showBib: false });
  });

  // T-230: on a gated event before any search, the panel inside the gallery owns
  // the call to action. Two search buttons on one otherwise-empty screen is
  // worse than the split that forced the old "take a selfie above" copy.
  it('hides the banner on a gated event before the visitor has searched', () => {
    expect(
      resolveFindMyPhotos({
        faceSearchActive: false,
        aiSearchEligible: true,
        bibDetectionEnabled: false,
        revealGatedPreSearch: true,
      }),
    ).toEqual({ visible: false, showFace: false, showBib: false });
  });

  it('leaves a non-gated event untouched (the banner keeps owning the CTA)', () => {
    expect(
      resolveFindMyPhotos({
        faceSearchActive: false,
        aiSearchEligible: true,
        bibDetectionEnabled: true,
        revealGatedPreSearch: false,
      }),
    ).toEqual({ visible: true, showFace: true, showBib: true });
  });
});

/**
 * Which view owns the gallery slot (T-230). Shared by both event viewers.
 *
 * The regression this pins: an active face search must outrank an empty grid.
 * A reveal-gated event's grid is empty by design until a reload carries the
 * proof cookie, so the public viewer's old "empty first" ordering answered a
 * successful search with its empty paragraph — hiding the very photos the
 * visitor had just proven they were in.
 */
describe('resolveEventGalleryView', () => {
  it('shows the search results over an empty grid (the gated-event regression)', () => {
    expect(
      resolveEventGalleryView({ hasPhotos: false, faceSearchActive: true, gatedPanel: true }),
    ).toBe('search-results');
  });

  it('shows the search results over an empty grid on a non-gated event too', () => {
    expect(
      resolveEventGalleryView({ hasPhotos: false, faceSearchActive: true, gatedPanel: false }),
    ).toBe('search-results');
  });

  it('shows the gated panel when nothing is revealed and no search has run', () => {
    expect(
      resolveEventGalleryView({ hasPhotos: false, faceSearchActive: false, gatedPanel: true }),
    ).toBe('gated-panel');
  });

  it('falls back to the plain empty state on a non-gated event with no photos', () => {
    expect(
      resolveEventGalleryView({ hasPhotos: false, faceSearchActive: false, gatedPanel: false }),
    ).toBe('empty');
  });

  it('lets an in-flight upload keep the empty slot for its own progress copy', () => {
    expect(
      resolveEventGalleryView({
        hasPhotos: false,
        faceSearchActive: false,
        gatedPanel: true,
        isUploading: true,
      }),
    ).toBe('empty');
  });

  it('renders the grid once photos are revealed and no search is active', () => {
    expect(
      resolveEventGalleryView({ hasPhotos: true, faceSearchActive: false, gatedPanel: true }),
    ).toBe('grid');
  });

  it('still prefers the results view over a populated grid during a search', () => {
    expect(
      resolveEventGalleryView({ hasPhotos: true, faceSearchActive: true, gatedPanel: false }),
    ).toBe('search-results');
  });
});

/**
 * Copy selection for the banner header (T-080). The bug fixed here: with BOTH
 * methods enabled, the banner used to show the face-only description, ignoring
 * bib. These pin the neutral title + a method-specific description per combo.
 */
describe('resolveFindMyPhotosCopy', () => {
  const labels = {
    title: 'Find your photos',
    titleIndexing: 'Processing photos…',
    descriptionFace: 'FACE',
    descriptionBib: 'BIB',
    descriptionBoth: 'BOTH',
    descriptionIndexing: 'INDEXING',
  };

  it('uses the face-only description when only face is available', () => {
    expect(
      resolveFindMyPhotosCopy(labels, { hasFace: true, hasBib: false, indexing: false }),
    ).toEqual({ title: 'Find your photos', description: 'FACE' });
  });

  it('uses the bib-only description when only bib is available', () => {
    expect(
      resolveFindMyPhotosCopy(labels, { hasFace: false, hasBib: true, indexing: false }),
    ).toEqual({ title: 'Find your photos', description: 'BIB' });
  });

  it('uses the combined description when both methods are available (the T-080 bug)', () => {
    expect(
      resolveFindMyPhotosCopy(labels, { hasFace: true, hasBib: true, indexing: false }),
    ).toEqual({ title: 'Find your photos', description: 'BOTH' });
  });

  it('keeps the indexing copy regardless of bib while face is still indexing', () => {
    expect(
      resolveFindMyPhotosCopy(labels, { hasFace: true, hasBib: true, indexing: true }),
    ).toEqual({ title: 'Processing photos…', description: 'INDEXING' });
  });
});

/**
 * Reveal gate dead-end guard (T-184). A gated event reveals photos only via face
 * search, so when the search entry can't render (nothing indexed / indexing /
 * failed) the visitor is stranded — these pin which explanatory notice shows so
 * a gallery renders a clear state instead of a mute empty grid.
 */
describe('resolveGatedFaceSearchNotice', () => {
  it('shows no notice for a non-gated event (browses normally, even with nothing indexed)', () => {
    expect(
      resolveGatedFaceSearchNotice({
        gated: false,
        aiSearchEligible: false,
        aiUsable: true,
        aiStatus: 'idle',
      }),
    ).toBe('none');
  });

  it('shows no notice when the gated event is searchable (indexed>0) — the banner renders', () => {
    expect(
      resolveGatedFaceSearchNotice({
        gated: true,
        aiSearchEligible: true,
        aiUsable: true,
        aiStatus: 'ready',
      }),
    ).toBe('none');
  });

  it('shows "processing" for a gated event with AI enabled but nothing indexed yet (idle — the reported bug)', () => {
    expect(
      resolveGatedFaceSearchNotice({
        gated: true,
        aiSearchEligible: false,
        aiUsable: true,
        aiStatus: 'idle',
      }),
    ).toBe('processing');
  });

  it('shows "processing" for a gated event still indexing with nothing indexed yet', () => {
    expect(
      resolveGatedFaceSearchNotice({
        gated: true,
        aiSearchEligible: false,
        aiUsable: true,
        aiStatus: 'indexing',
      }),
    ).toBe('processing');
  });

  it('shows "unavailable" for a gated event whose indexing failed', () => {
    expect(
      resolveGatedFaceSearchNotice({
        gated: true,
        aiSearchEligible: false,
        aiUsable: false,
        aiStatus: 'failed',
      }),
    ).toBe('unavailable');
  });

  it('shows "unavailable" for a gated event that finished indexing but has nothing searchable (ready + 0 indexed)', () => {
    expect(
      resolveGatedFaceSearchNotice({
        gated: true,
        aiSearchEligible: false,
        aiUsable: true,
        aiStatus: 'ready',
      }),
    ).toBe('unavailable');
  });

  it('shows "unavailable" for a gated event with AI not usable (disabled / no collection)', () => {
    expect(
      resolveGatedFaceSearchNotice({
        gated: true,
        aiSearchEligible: false,
        aiUsable: false,
        aiStatus: null,
      }),
    ).toBe('unavailable');
  });
});
