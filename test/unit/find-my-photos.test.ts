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
import { resolveFindMyPhotos, resolveFindMyPhotosCopy } from '@/lib/find-my-photos';

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
