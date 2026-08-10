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
  /**
   * Reveal gate is on AND nothing has been revealed yet (T-230). The gated
   * pre-search panel owns the call to action in that case, so this banner must
   * step aside — two search buttons on one empty screen is worse than none, and
   * the split is what forced the old copy to say "take a selfie *above*".
   */
  revealGatedPreSearch?: boolean;
}): FindMyPhotosVisibility {
  if (params.faceSearchActive || params.revealGatedPreSearch) {
    return { visible: false, showFace: false, showBib: false };
  }
  const showFace = params.aiSearchEligible;
  const showBib = params.bibDetectionEnabled;
  return { visible: showFace || showBib, showFace, showBib };
}

/** Which of the gallery slot's mutually exclusive views renders (T-230). */
export type EventGalleryView = 'search-results' | 'gated-panel' | 'empty' | 'grid';

/**
 * Pick the gallery slot's view. Shared by both event viewers so the public page
 * and the talent dashboard can't disagree about the same event.
 *
 * ⚠️ **An active face search outranks emptiness.** On a reveal-gated event the
 * grid is empty by design until a proof cookie is presented, so the matched set
 * arriving from the search is the ONLY thing the viewer has to render — the
 * public viewer used to test emptiness first and therefore answered a successful
 * search with its empty paragraph, hiding the very photos the visitor had just
 * proven they were in. (The talent viewer already returned results first; this
 * makes the two agree.) A non-gated event is unaffected in practice: it can only
 * be searched once something is indexed, so an empty grid plus an active search
 * means "searched, no matches" — which the results view states, and the empty
 * paragraph doesn't.
 */
export function resolveEventGalleryView(params: {
  /** The (paginated, deletion-filtered) grid has at least one photo. */
  hasPhotos: boolean;
  /** A face search has run (`matches !== null`) — including a zero-match one. */
  faceSearchActive: boolean;
  /** The caller supplied gated-panel labels, i.e. the event is reveal-gated. */
  gatedPanel: boolean;
  /** An upload is in flight — its own progress copy owns the empty slot. */
  isUploading?: boolean;
}): EventGalleryView {
  if (params.faceSearchActive) return 'search-results';
  if (params.hasPhotos) return 'grid';
  if (params.gatedPanel && !params.isUploading) return 'gated-panel';
  return 'empty';
}

/**
 * Reveal gate (T-177) dead-end guard (T-184).
 *
 * A gated event reveals its photos ONLY to a visitor who proves a face-search
 * match — nothing is browsable up front. So if the face-search entry can't
 * render (the event isn't searchable yet: nothing indexed, indexing in flight,
 * or indexing failed), the visitor is stuck with no photos AND no way to find
 * them — a silent dead-end. This resolves which explanatory notice to show in
 * that case, so the gallery shows a clear state instead of a mute empty grid.
 *
 * Non-gated events are never at risk: their photos browse normally, so hiding
 * the (useless) face-search entry when nothing is indexed is correct there —
 * hence `'none'` whenever `!gated`.
 */
export type GatedFaceSearchNotice = 'none' | 'processing' | 'unavailable';

export function resolveGatedFaceSearchNotice(params: {
  /** Event has the reveal gate on. */
  gated: boolean;
  /** Face search is usable right now (server-computed: enabled + collection +
   * not-failed + at least one indexed photo). When true, the banner renders and
   * there is no dead-end. */
  aiSearchEligible: boolean;
  /** AI face matching is set up and could still produce results — enabled, not
   * a minors event, collection exists, and indexing hasn't terminally failed. */
  aiUsable: boolean;
  /** Rekognition indexing status for the event. */
  aiStatus: 'idle' | 'indexing' | 'ready' | 'failed' | null;
}): GatedFaceSearchNotice {
  if (!params.gated) return 'none';
  // The face-search entry renders → the visitor can search → no dead-end.
  if (params.aiSearchEligible) return 'none';
  // Gated + not eligible: distinguish "results are still coming" from "face
  // search will never help here".
  //   - idle: AI enabled but the backfill hasn't indexed yet (the reported
  //     case — shares the worker-reliability root with T-183/T-099).
  //   - indexing: in flight.
  // Both are "processing". Anything else (failed / ready-but-nothing-indexed /
  // AI not usable) is a terminal "unavailable".
  if (params.aiUsable && (params.aiStatus === 'idle' || params.aiStatus === 'indexing')) {
    return 'processing';
  }
  return 'unavailable';
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
