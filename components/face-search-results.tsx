'use client';

import { ArrowLeft, Camera, Frown } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  BucketedMatches,
  FaceSearchResultsLabels,
} from '@/app/[lang]/events/[shareCode]/face-search-shared';
import type { PhotoAlbumItem, PhotoGallerySection } from '@/components/photo-gallery';
import { Button } from '@/components/ui/button';

interface FaceSearchResultsProps {
  bucketed: BucketedMatches<PhotoAlbumItem>;
  /** Total number of matched photos across all buckets. */
  matchCount: number;
  eventIndexingComplete: boolean;
  resultsLabels: FaceSearchResultsLabels;
  /** Re-opens the search modal (no-matches "try again"). */
  onTryAgain: () => void;
  /** Returns to the full gallery. */
  onViewAll: () => void;
  /** Renders the bucketed photos — a `<PhotoGallery sections>` from the host
   * viewer, so the bucket tiles get the same action layer as the full grid. */
  renderGallery: (sections: PhotoGallerySection[]) => ReactNode;
}

/**
 * The AI face-search results view: a "we found N photos" message above the
 * confidence-bucketed gallery, or the no-matches empty state. The gallery
 * itself is produced by the host viewer's `renderGallery` (a `PhotoGallery`
 * with `sections`) so selection, the lightbox and the per-photo actions are
 * identical to the normal gallery.
 */
export function FaceSearchResults({
  bucketed,
  matchCount,
  eventIndexingComplete,
  resultsLabels,
  onTryAgain,
  onViewAll,
  renderGallery,
}: FaceSearchResultsProps) {
  if (matchCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-input bg-muted/30 px-6 py-12 text-center">
        <Frown className="h-10 w-10 text-muted-foreground opacity-50" aria-hidden="true" />
        <h3 className="text-base font-semibold">{resultsLabels.noMatchesTitle}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{resultsLabels.noMatchesBody}</p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" size="sm" onClick={onTryAgain}>
            <Camera className="mr-1.5 h-4 w-4" />
            {resultsLabels.tryAgain}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onViewAll}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {resultsLabels.viewAllPhotos}
          </Button>
        </div>
      </div>
    );
  }

  const foundMessage =
    matchCount === 1
      ? resultsLabels.foundCountOne
      : resultsLabels.foundCountMany.replace('{n}', String(matchCount));

  const sections: PhotoGallerySection[] = [
    {
      key: 'very-likely',
      title: resultsLabels.veryLikelyTitle,
      subtitle: resultsLabels.veryLikelySubtitle,
      items: bucketed.veryLikely,
    },
    {
      key: 'likely',
      title: resultsLabels.likelyTitle,
      subtitle: resultsLabels.likelySubtitle,
      items: bucketed.likely,
    },
    {
      key: 'possibly',
      title: resultsLabels.possiblyTitle,
      subtitle: resultsLabels.possiblySubtitle,
      items: bucketed.possibly,
    },
  ].filter((section) => section.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium">{foundMessage}</p>
      {renderGallery(sections)}
      {!eventIndexingComplete ? (
        <p className="text-xs text-muted-foreground">{resultsLabels.partialIndexingNotice}</p>
      ) : null}
    </div>
  );
}
