'use client';

import { ArrowLeft, Camera, Frown } from 'lucide-react';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import type {
  SearchFacesInEventResult,
  SearchMatchBucket,
} from '@/app/[lang]/events/[shareCode]/face-search-shared';
import {
  AIFindPhotosBanner,
  type AIFindPhotosBannerLabels,
} from '@/components/ai-find-photos-banner';
import { FaceSearchModal, type FaceSearchModalLabels } from '@/components/face-search-modal';
import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoIconTooltips } from '@/components/photo-icon-buttons';
import { Button } from '@/components/ui/button';

export interface FaceSearchResultsLabels {
  veryLikelyTitle: string;
  veryLikelySubtitle: string;
  likelyTitle: string;
  likelySubtitle: string;
  possiblyTitle: string;
  possiblySubtitle: string;
  viewAllPhotos: string;
  noMatchesTitle: string;
  noMatchesBody: string;
  tryAgain: string;
  partialIndexingNotice: string;
}

interface EventGalleryWithFaceSearchProps {
  /**
   * Full ordered photo list (already filtered to `upload_status='approved'`
   * by the server). Used to render the full gallery and to filter into
   * match buckets on the client.
   */
  photos: PhotoAlbumItem[];
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
  resultsLabels: FaceSearchResultsLabels;
  /** Pass-through props for the matches-view `<PhotoAlbumViewer>` instances. */
  iconTooltips?: Partial<PhotoIconTooltips>;
  imageUnavailableLabel: string;
  /** Labels for the "Uploaded by" badge on the match-result tiles. */
  uploaderLabels?: {
    tooltip: string;
    popoverHeading: string;
    guestLabel: string;
    authenticatedLabel: string;
  };
  /**
   * Rendered when `searchMatches === null`. The parent passes its existing
   * full-gallery component (`<PublicEventPhotoViewer>` / `<EventPhotoViewer>`)
   * here; this wrapper takes care of the banner + matches branch only.
   */
  fullGallery: ReactNode;
}

interface ClientSearchMatch {
  photoId: string;
  similarity: number;
  bucket: SearchMatchBucket;
}

/**
 * Wraps the existing full gallery with the AI face-search affordance:
 *
 *   - Renders `<AIFindPhotosBanner>` above when eligible.
 *   - Owns the search-modal open state and the search-results client state.
 *   - When matches exist: replaces the full gallery with bucketed sections
 *     (one `<PhotoAlbumViewer>` per non-empty bucket). The "View all photos"
 *     button resets state and brings the full gallery back.
 *   - When matches is an empty array: shows the "no matches" empty state.
 *   - When matches is null (no search performed yet): renders `fullGallery`
 *     as-is.
 *
 * This wrapper deliberately doesn't pass cart/lightbox props to the
 * matched-photos `<PhotoAlbumViewer>` instances — `PhotoAlbumItem` already
 * carries the click affordances the album viewer needs (lightbox is built
 * into the viewer). Cart icons inside the lightbox aren't required for v0
 * matches view — talents return to the full gallery via "View all photos"
 * to add matched photos to cart.
 */
export function EventGalleryWithFaceSearch({
  photos,
  shareCode,
  aiSearchEligible,
  aiState,
  bannerLabels,
  modalLabels,
  resultsLabels,
  iconTooltips,
  imageUnavailableLabel,
  uploaderLabels,
  fullGallery,
}: EventGalleryWithFaceSearchProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<ClientSearchMatch[] | null>(null);
  const [eventIndexingComplete, setEventIndexingComplete] = useState(true);

  const onSearchResult = (result: SearchFacesInEventResult) => {
    if (result.reason === 'collection-missing') {
      // The event lost AI support mid-flight. Don't render a matches view —
      // just keep the full gallery. The next page render will see the AI
      // disabled state and hide the banner too.
      setSearchMatches(null);
      return;
    }
    setSearchMatches(result.matches);
    setEventIndexingComplete(result.eventIndexingComplete);
  };

  const photoLookup = useMemo(() => {
    const map = new Map<string, PhotoAlbumItem>();
    for (const p of photos) map.set(p.id, p);
    return map;
  }, [photos]);

  /**
   * Build the bucketed match arrays. Within each bucket, sort by similarity
   * descending so the user sees the most confident matches first.
   */
  const bucketed = useMemo(() => {
    if (!searchMatches || searchMatches.length === 0) {
      return { veryLikely: [], likely: [], possibly: [] };
    }
    const veryLikely: PhotoAlbumItem[] = [];
    const likely: PhotoAlbumItem[] = [];
    const possibly: PhotoAlbumItem[] = [];

    const sorted = [...searchMatches].sort((a, b) => b.similarity - a.similarity);
    for (const match of sorted) {
      const item = photoLookup.get(match.photoId);
      if (!item) continue; // orphan filtered server-side, but defend client-side too
      switch (match.bucket) {
        case 'very-likely':
          veryLikely.push(item);
          break;
        case 'likely':
          likely.push(item);
          break;
        case 'possibly':
          possibly.push(item);
          break;
      }
    }
    return { veryLikely, likely, possibly };
  }, [searchMatches, photoLookup]);

  const showMatchesView = searchMatches !== null;
  const hasAnyMatch = searchMatches !== null && searchMatches.length > 0;

  return (
    // React reconciles the children of this outer <div> as a positional
    // array. The "gallery" slot can swap between two distinct element types
    // (the matches view OR `fullGallery` passed in from EventPage), and the
    // outermost `fullGallery` element was created by a different component
    // — without an explicit key React's strict-mode reconciler emits a
    // "missing key" warning. Stable keys on each of the three top-level
    // slots resolve it.
    <div className="flex flex-col gap-4">
      {aiSearchEligible && !showMatchesView ? (
        <AIFindPhotosBanner
          key="ai-find-photos-banner"
          state={aiState}
          labels={bannerLabels}
          onOpenSearch={() => setModalOpen(true)}
        />
      ) : null}

      {showMatchesView ? (
        <div key="ai-search-matches" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSearchMatches(null)}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {resultsLabels.viewAllPhotos}
            </Button>
          </div>

          {hasAnyMatch ? (
            <>
              {bucketed.veryLikely.length > 0 ? (
                <BucketSection
                  title={resultsLabels.veryLikelyTitle}
                  subtitle={resultsLabels.veryLikelySubtitle}
                  items={bucketed.veryLikely}
                  iconTooltips={iconTooltips}
                  imageUnavailableLabel={imageUnavailableLabel}
                  uploaderLabels={uploaderLabels}
                />
              ) : null}
              {bucketed.likely.length > 0 ? (
                <BucketSection
                  title={resultsLabels.likelyTitle}
                  subtitle={resultsLabels.likelySubtitle}
                  items={bucketed.likely}
                  iconTooltips={iconTooltips}
                  imageUnavailableLabel={imageUnavailableLabel}
                  uploaderLabels={uploaderLabels}
                />
              ) : null}
              {bucketed.possibly.length > 0 ? (
                <BucketSection
                  title={resultsLabels.possiblyTitle}
                  subtitle={resultsLabels.possiblySubtitle}
                  items={bucketed.possibly}
                  iconTooltips={iconTooltips}
                  imageUnavailableLabel={imageUnavailableLabel}
                  uploaderLabels={uploaderLabels}
                />
              ) : null}
              {!eventIndexingComplete ? (
                <p className="text-xs text-muted-foreground">
                  {resultsLabels.partialIndexingNotice}
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-input bg-muted/30 px-6 py-12 text-center">
              <Frown className="h-10 w-10 text-muted-foreground opacity-50" aria-hidden="true" />
              <h3 className="text-base font-semibold">{resultsLabels.noMatchesTitle}</h3>
              <p className="max-w-md text-sm text-muted-foreground">
                {resultsLabels.noMatchesBody}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={() => setModalOpen(true)}>
                  <Camera className="mr-1.5 h-4 w-4" />
                  {resultsLabels.tryAgain}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchMatches(null)}
                >
                  {resultsLabels.viewAllPhotos}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <Fragment key="full-gallery">{fullGallery}</Fragment>
      )}

      <FaceSearchModal
        key="face-search-modal"
        open={modalOpen}
        onOpenChange={setModalOpen}
        shareCode={shareCode}
        labels={modalLabels}
        onResult={onSearchResult}
      />
    </div>
  );
}

interface BucketSectionProps {
  title: string;
  subtitle: string;
  items: PhotoAlbumItem[];
  iconTooltips?: Partial<PhotoIconTooltips>;
  imageUnavailableLabel: string;
  uploaderLabels?: {
    tooltip: string;
    popoverHeading: string;
    guestLabel: string;
    authenticatedLabel: string;
  };
}

function BucketSection({
  title,
  subtitle,
  items,
  iconTooltips,
  imageUnavailableLabel,
  uploaderLabels,
}: BucketSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </header>
      <PhotoAlbumViewer
        items={items}
        iconTooltips={iconTooltips}
        imageUnavailableLabel={imageUnavailableLabel}
        uploaderLabels={uploaderLabels}
      />
    </section>
  );
}
