'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import type {
  ClientSearchMatch,
  SearchFacesInEventResult,
} from '@/app/[lang]/events/[shareCode]/face-search-shared';
import type { PublicPhotoAlbumItem } from '@/app/[lang]/events/[shareCode]/photo-album-item';
import { FaceSearchModal, type FaceSearchModalLabels } from '@/components/face-search-modal';
import { FindMyPhotosBanner, type FindMyPhotosLabels } from '@/components/find-my-photos-banner';
import { resolveFindMyPhotos } from '@/lib/find-my-photos';

interface FaceSearchContextValue {
  /** null = no search performed; [] = searched, no matches; [...] = matches. */
  matches: ClientSearchMatch[] | null;
  /** The matched photos, signed + complete — bucketed by the viewer instead of
   * the paginated grid so a match beyond the loaded page still renders. */
  matchedPhotos: PublicPhotoAlbumItem[];
  /** false when the event still had un-indexed photos at search time. */
  eventIndexingComplete: boolean;
  /** Clears matches → the viewer falls back to the full grid. */
  clearMatches: () => void;
  /** Opens the face-search modal. */
  openSearch: () => void;
}

const FaceSearchContext = createContext<FaceSearchContextValue | null>(null);

/**
 * Face-search state for the gallery viewer. The viewer is rendered as
 * `fullGallery` inside `<EventGalleryWithFaceSearch>`, so it always has a
 * provider.
 */
export function useFaceSearch(): FaceSearchContextValue {
  const ctx = useContext(FaceSearchContext);
  if (!ctx) {
    throw new Error('useFaceSearch must be used within <EventGalleryWithFaceSearch>');
  }
  return ctx;
}

interface BibSearchContextValue {
  /** null = no bib search active; [] = searched, no matches; [...] = matched photo ids. */
  matchedPhotoIds: string[] | null;
  /** The matched photos, signed + complete — rendered directly by the viewer so
   * a bib match beyond the loaded page still appears. */
  matchedPhotos: PublicPhotoAlbumItem[];
}

const BibSearchContext = createContext<BibSearchContextValue>({
  matchedPhotoIds: null,
  matchedPhotos: [],
});

/** The payload the bib search forwards on a search, or `null` when cleared. */
export interface BibSearchResult {
  photoIds: string[];
  matchedPhotos: PublicPhotoAlbumItem[];
}

/**
 * Bib-search match state for the gallery viewer. Safe to call outside a
 * provider (returns "no search active") so viewers that don't surface bib
 * search just render the full grid.
 */
export function useBibSearch(): BibSearchContextValue {
  return useContext(BibSearchContext);
}

interface EventGalleryWithFaceSearchProps {
  shareCode: string;
  /**
   * Whether the AI-search banner should render at all. Computed server-side
   * from `event.ai_matching_enabled` + indexing progress.
   */
  aiSearchEligible: boolean;
  /** `'ready'` or `'indexing'`. Ignored when `aiSearchEligible === false`. */
  aiState: 'ready' | 'indexing';
  modalLabels: FaceSearchModalLabels;
  /** Copy for the unified "Find my photos" section (face + bib buttons). */
  findLabels: FindMyPhotosLabels;
  /** When true, render the bib-search button (gated server-side on the event's
   * `bib_detection_enabled`). */
  bibDetectionEnabled?: boolean;
  /**
   * The gallery viewer (`<PublicEventPhotoViewer>` / `<EventPhotoViewer>`).
   * It consumes `useFaceSearch()` to swap between the full grid and the
   * bucketed results, so its per-photo action layer applies to both.
   */
  fullGallery: ReactNode;
}

/**
 * Owns the AI face-search state — the search modal + the search results — and
 * exposes it via context. Renders the unified "Find my photos" banner (face +
 * bib buttons, until a face search is run) and the gallery viewer. The viewer
 * itself decides whether to render the full grid or the bucketed results from
 * `useFaceSearch()`.
 */
export function EventGalleryWithFaceSearch({
  shareCode,
  aiSearchEligible,
  aiState,
  modalLabels,
  findLabels,
  bibDetectionEnabled = false,
  fullGallery,
}: EventGalleryWithFaceSearchProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [matches, setMatches] = useState<ClientSearchMatch[] | null>(null);
  const [matchedPhotos, setMatchedPhotos] = useState<PublicPhotoAlbumItem[]>([]);
  const [eventIndexingComplete, setEventIndexingComplete] = useState(true);
  const [bibMatched, setBibMatched] = useState<BibSearchResult | null>(null);

  const onSearchResult = useCallback((result: SearchFacesInEventResult) => {
    if (result.reason === 'collection-missing') {
      // The event lost AI support mid-flight — keep the full gallery.
      setMatches(null);
      setMatchedPhotos([]);
      return;
    }
    setMatches(result.matches);
    setMatchedPhotos(result.matchedPhotos);
    setEventIndexingComplete(result.eventIndexingComplete);
  }, []);

  const value = useMemo<FaceSearchContextValue>(
    () => ({
      matches,
      matchedPhotos,
      eventIndexingComplete,
      clearMatches: () => {
        setMatches(null);
        setMatchedPhotos([]);
      },
      openSearch: () => setModalOpen(true),
    }),
    [matches, matchedPhotos, eventIndexingComplete],
  );

  const findPhotos = resolveFindMyPhotos({
    faceSearchActive: matches !== null,
    aiSearchEligible,
    bibDetectionEnabled,
  });

  return (
    <FaceSearchContext.Provider value={value}>
      <BibSearchContext.Provider
        value={{
          matchedPhotoIds: bibMatched?.photoIds ?? null,
          matchedPhotos: bibMatched?.matchedPhotos ?? [],
        }}
      >
        <div className="flex flex-col gap-2">
          {findPhotos.visible ? (
            <FindMyPhotosBanner
              key="find-my-photos-banner"
              labels={findLabels}
              face={
                findPhotos.showFace
                  ? { state: aiState, onOpen: () => setModalOpen(true) }
                  : undefined
              }
              bib={
                findPhotos.showBib
                  ? {
                      shareCode,
                      onResults: setBibMatched,
                      hasResults: bibMatched !== null,
                    }
                  : undefined
              }
            />
          ) : null}
          {fullGallery}
          <FaceSearchModal
            key="face-search-modal"
            open={modalOpen}
            onOpenChange={setModalOpen}
            shareCode={shareCode}
            labels={modalLabels}
            onResult={onSearchResult}
          />
        </div>
      </BibSearchContext.Provider>
    </FaceSearchContext.Provider>
  );
}
