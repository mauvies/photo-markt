'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import type {
  ClientSearchMatch,
  SearchFacesInEventResult,
} from '@/app/[lang]/events/[shareCode]/face-search-shared';
import {
  AIFindPhotosBanner,
  type AIFindPhotosBannerLabels,
} from '@/components/ai-find-photos-banner';
import { FaceSearchModal, type FaceSearchModalLabels } from '@/components/face-search-modal';

interface FaceSearchContextValue {
  /** null = no search performed; [] = searched, no matches; [...] = matches. */
  matches: ClientSearchMatch[] | null;
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

interface EventGalleryWithFaceSearchProps {
  shareCode: string;
  /**
   * Whether the AI-search banner should render at all. Computed server-side
   * from `event.ai_matching_enabled` + indexing progress.
   */
  aiSearchEligible: boolean;
  /** `'ready'` or `'indexing'`. Ignored when `aiSearchEligible === false`. */
  aiState: 'ready' | 'indexing';
  bannerLabels: AIFindPhotosBannerLabels;
  modalLabels: FaceSearchModalLabels;
  /**
   * The gallery viewer (`<PublicEventPhotoViewer>` / `<EventPhotoViewer>`).
   * It consumes `useFaceSearch()` to swap between the full grid and the
   * bucketed results, so its per-photo action layer applies to both.
   */
  fullGallery: ReactNode;
}

/**
 * Owns the AI face-search state — the search modal + the search results — and
 * exposes it via context. Renders the "AI find photos" banner (until a search
 * is run) and the gallery viewer. The viewer itself decides whether to render
 * the full grid or the bucketed results from `useFaceSearch()`.
 */
export function EventGalleryWithFaceSearch({
  shareCode,
  aiSearchEligible,
  aiState,
  bannerLabels,
  modalLabels,
  fullGallery,
}: EventGalleryWithFaceSearchProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [matches, setMatches] = useState<ClientSearchMatch[] | null>(null);
  const [eventIndexingComplete, setEventIndexingComplete] = useState(true);

  const onSearchResult = useCallback((result: SearchFacesInEventResult) => {
    if (result.reason === 'collection-missing') {
      // The event lost AI support mid-flight — keep the full gallery.
      setMatches(null);
      return;
    }
    setMatches(result.matches);
    setEventIndexingComplete(result.eventIndexingComplete);
  }, []);

  const value = useMemo<FaceSearchContextValue>(
    () => ({
      matches,
      eventIndexingComplete,
      clearMatches: () => setMatches(null),
      openSearch: () => setModalOpen(true),
    }),
    [matches, eventIndexingComplete],
  );

  return (
    <FaceSearchContext.Provider value={value}>
      <div className="flex flex-col gap-4">
        {aiSearchEligible && matches === null ? (
          <AIFindPhotosBanner
            state={aiState}
            labels={bannerLabels}
            onOpenSearch={() => setModalOpen(true)}
          />
        ) : null}
        {fullGallery}
        <FaceSearchModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          shareCode={shareCode}
          labels={modalLabels}
          onResult={onSearchResult}
        />
      </div>
    </FaceSearchContext.Provider>
  );
}
