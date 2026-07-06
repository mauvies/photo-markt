/**
 * Visibility logic for the unified "Find my photos" section on event pages.
 *
 * The section merges the AI face-search invite and the bib-number search into
 * one card with a button per enabled capability. Kept as a pure function so the
 * gating (which buttons show for which flag combination) is testable without a
 * DOM.
 */

export interface FindMyPhotosVisibility {
  /** Whether the section renders at all. */
  visible: boolean;
  /** Whether the face-search button renders. */
  showFace: boolean;
  /** Whether the bib-search button renders. */
  showBib: boolean;
}

export function resolveFindMyPhotos(params: {
  /** A face search is active (`matches !== null`) — the grid is showing bucketed
   * results, so the invite section is hidden. */
  faceSearchActive: boolean;
  /** Event is eligible for AI face search (server-computed). */
  aiSearchEligible: boolean;
  /** Event has bib detection enabled (server-computed). */
  bibDetectionEnabled: boolean;
}): FindMyPhotosVisibility {
  if (params.faceSearchActive) {
    return { visible: false, showFace: false, showBib: false };
  }
  const showFace = params.aiSearchEligible;
  const showBib = params.bibDetectionEnabled;
  return { visible: showFace || showBib, showFace, showBib };
}
