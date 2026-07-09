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

/** Header copy for the "Find my photos" banner, keyed by which methods apply. */
export interface FindMyPhotosCopyLabels {
  /** Method-neutral title used for the ready state (face, bib, or both). */
  title: string;
  /** Title while face indexing is still in progress. */
  titleIndexing: string;
  /** Ready-state description when only face search is available. */
  descriptionFace: string;
  /** Ready-state description when only bib search is available. */
  descriptionBib: string;
  /** Ready-state description when both face and bib search are available. */
  descriptionBoth: string;
  /** Description while face indexing is still in progress. */
  descriptionIndexing: string;
}

/**
 * Pick the banner's title + description from the methods enabled on the event.
 *
 * The ready-state description is method-specific (face-only / bib-only / both),
 * which is the whole point of T-080 — before it, an event with BOTH methods
 * showed the face-only copy. The `indexing` state (face photos still
 * processing) is orthogonal to the method mix, so it keeps its own copy
 * regardless of bib.
 */
export function resolveFindMyPhotosCopy(
  labels: FindMyPhotosCopyLabels,
  state: { hasFace: boolean; hasBib: boolean; indexing: boolean },
): { title: string; description: string } {
  const { hasFace, hasBib, indexing } = state;
  if (hasFace && indexing) {
    return { title: labels.titleIndexing, description: labels.descriptionIndexing };
  }
  const description =
    hasFace && hasBib
      ? labels.descriptionBoth
      : hasFace
        ? labels.descriptionFace
        : labels.descriptionBib;
  return { title: labels.title, description };
}
