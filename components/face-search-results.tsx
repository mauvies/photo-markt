'use client';

import { ArrowLeft, Camera, Frown } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  BucketedMatches,
  FaceSearchResultsLabels,
} from '@/app/[lang]/events/[shareCode]/face-search-shared';
import type { PhotoAlbumItem } from '@/components/photo-album-viewer';
import { Button } from '@/components/ui/button';

interface FaceSearchResultsProps {
  bucketed: BucketedMatches<PhotoAlbumItem>;
  /** Total number of matched photos across all buckets. */
  matchCount: number;
  eventIndexingComplete: boolean;
  resultsLabels: FaceSearchResultsLabels;
  /** Renders one grid of photos with the viewer's full per-photo action layer. */
  renderGrid: (items: PhotoAlbumItem[]) => ReactNode;
  /** The selection toolbar row — back button in its `leading` slot + Select. */
  toolbar: ReactNode;
  /** Re-opens the search modal (no-matches "try again"). */
  onTryAgain: () => void;
  /** Returns to the full gallery. */
  onViewAll: () => void;
}

/**
 * The AI face-search results view: a "we found N photos" message, the
 * selection toolbar row, then the confidence-bucketed photo sections — or the
 * no-matches empty state. The photo grids are produced by the caller's
 * `renderGrid` so the bucket tiles get the exact same per-photo action layer
 * (selection, 3-dot dropdown, …) as the normal gallery.
 */
export function FaceSearchResults({
  bucketed,
  matchCount,
  eventIndexingComplete,
  resultsLabels,
  renderGrid,
  toolbar,
  onTryAgain,
  onViewAll,
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

  const sections = [
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
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium">{foundMessage}</p>
      {toolbar}
      {sections.map((section) =>
        section.items.length > 0 ? (
          <section key={section.key} className="flex flex-col gap-2">
            <header>
              <h3 className="text-sm font-semibold">{section.title}</h3>
              <p className="text-xs text-muted-foreground">{section.subtitle}</p>
            </header>
            {renderGrid(section.items)}
          </section>
        ) : null,
      )}
      {!eventIndexingComplete ? (
        <p className="text-xs text-muted-foreground">{resultsLabels.partialIndexingNotice}</p>
      ) : null}
    </div>
  );
}
