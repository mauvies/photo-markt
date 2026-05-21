'use client';

import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  addPhotoToCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import { getEventPhotoDownloadUrlAction } from '@/app/[lang]/events/[shareCode]/actions';
import {
  buildBuckets,
  type FaceSearchResultsLabels,
} from '@/app/[lang]/events/[shareCode]/face-search-shared';
import { useFaceSearch } from '@/components/event-gallery-with-face-search';
import { type EventPhotoFilter, EventPhotoFilterTabs } from '@/components/event-photo-filter-tabs';
import { FaceSearchResults } from '@/components/face-search-results';
import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoIconTooltips, PhotoMoreMenuConfig } from '@/components/photo-icon-buttons';
import {
  type BulkDownloadLabels,
  PhotoSelectionToolbar,
} from '@/components/photo-selection-toolbar';
import { Button } from '@/components/ui/button';
import { useBulkPhotoDownload } from '@/hooks/use-bulk-photo-download';
import { useOptimisticPhotosInCart } from '@/hooks/use-optimistic-photos-in-cart';
import { usePhotoSelection } from '@/hooks/use-photo-selection';
import { useTranslations } from '@/lib/i18n/translations-provider';
import {
  addPhotoToMyPhotosAction,
  addPhotoToProfileAction,
  removePhotoFromMyPhotosAction,
} from './actions';

/** Localized copy for the per-photo "more options" dropdown. */
export type PhotoMenuLabels = {
  trigger: string;
  download: string;
  addToFavorites: string;
  removeFromFavorites: string;
  addToProfile: string;
  addedToProfile: string;
  addToCart: string;
  removeFromCart: string;
  /** "Uploaded by {name}" template. */
  uploadedBy: string;
  downloadFailed: string;
  downloadNotPurchased: string;
};

type EventPhotoViewerProps = {
  items: PhotoAlbumItem[];
  eventId: string;
  /** Free events let anyone download; paid events restrict to purchased photos. */
  isFreeEvent: boolean;
  /** Collaborative events get the "All photos / My photos" filter + uploader row. */
  isCollaborative?: boolean;
  /** Photo IDs the current talent uploaded — backs the "My photos" filter. */
  uploadedPhotoIds?: Set<string>;
  /** Labels for the "All photos / My photos" filter (collaborative events). */
  filterLabels: { all: string; mine: string; empty: string };
  /** Labels for the per-photo "more options" dropdown. */
  menuLabels: PhotoMenuLabels;
  /** Labels for the AI face-search results view. */
  resultsLabels: FaceSearchResultsLabels;
  purchasedPhotoIds?: Set<string>;
  bulkDownload: BulkDownloadLabels;
  showAddToCart?: boolean;
  photosInCart?: Set<string>;
  /** Photo IDs in the talent's Favorites (talent_photo_tags). */
  photosInMyPhotos?: Set<string>;
  /** Photo IDs the talent has claimed into their profile (talent_claimed_photos). */
  photosClaimedToProfile?: Set<string>;
  iconTooltips?: Partial<PhotoIconTooltips>;
  imageUnavailableLabel: string;
};

export function EventPhotoViewer({
  items,
  eventId,
  isFreeEvent,
  isCollaborative = false,
  uploadedPhotoIds = new Set(),
  filterLabels,
  menuLabels,
  resultsLabels,
  purchasedPhotoIds = new Set(),
  bulkDownload,
  showAddToCart = false,
  photosInCart: initialPhotosInCart = new Set(),
  photosInMyPhotos: initialPhotosInMyPhotos = new Set(),
  photosClaimedToProfile: initialClaimedPhotos = new Set(),
  iconTooltips,
  imageUnavailableLabel,
}: EventPhotoViewerProps) {
  const { t } = useTranslations<{
    addedToPhotos: string;
    removedFromPhotos: string;
    addedToCart: string;
    removedFromCart: string;
    failedAddPhotos: string;
    failedRemovePhotos: string;
    failedAddCart: string;
    failedRemoveCart: string;
    photoAddedToProfile: string;
    failedAddProfile: string;
  }>();

  // Favorites — optimistic, seeded from the server prop.
  const [myPhotos, setMyPhotos] = useState<Set<string>>(initialPhotosInMyPhotos);
  useEffect(() => {
    setMyPhotos(initialPhotosInMyPhotos);
  }, [initialPhotosInMyPhotos]);

  // Claimed-to-profile — optimistic, seeded from the server prop. Add-only.
  const [claimedPhotos, setClaimedPhotos] = useState<Set<string>>(initialClaimedPhotos);
  useEffect(() => {
    setClaimedPhotos(initialClaimedPhotos);
  }, [initialClaimedPhotos]);

  // Optimistic cart state — the hook handles instant icon flip + badge sync.
  const { photosInCart, addToCart, removeFromCart } = useOptimisticPhotosInCart({
    initialPhotosInCart,
    addServerAction: addPhotoToCartAction,
    removeServerAction: removePhotoFromCartAction,
    toastLabels: { failedAdd: t('failedAddCart'), failedRemove: t('failedRemoveCart') },
  });

  const handleAddToCart = useCallback(
    (photoId: string) => {
      addToCart(photoId);
      toast.success(t('addedToCart'));
    },
    [addToCart, t],
  );

  const handleRemoveFromCart = useCallback(
    (photoId: string) => {
      removeFromCart(photoId);
      toast.success(t('removedFromCart'));
    },
    [removeFromCart, t],
  );

  const handleAddToPhotos = useCallback(
    async (photoId: string) => {
      setMyPhotos((prev) => new Set([...prev, photoId]));
      try {
        await addPhotoToMyPhotosAction(photoId);
        toast.success(t('addedToPhotos'));
      } catch (error) {
        setMyPhotos((prev) => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
        toast.error(error instanceof Error ? error.message : t('failedAddPhotos'));
        throw error;
      }
    },
    [t],
  );

  const handleRemoveFromPhotos = useCallback(
    async (photoId: string) => {
      setMyPhotos((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
      try {
        await removePhotoFromMyPhotosAction(photoId);
        toast.success(t('removedFromPhotos'));
      } catch (error) {
        setMyPhotos((prev) => new Set([...prev, photoId]));
        toast.error(error instanceof Error ? error.message : t('failedRemovePhotos'));
        throw error;
      }
    },
    [t],
  );

  const handleFavoriteToggle = useCallback(
    (photoId: string) => {
      if (myPhotos.has(photoId)) {
        void handleRemoveFromPhotos(photoId).catch(() => {});
      } else {
        void handleAddToPhotos(photoId).catch(() => {});
      }
    },
    [myPhotos, handleAddToPhotos, handleRemoveFromPhotos],
  );

  // Claim a free photo into the profile (owned collection). Add-only.
  const handleClaimToProfile = useCallback(
    async (photoId: string) => {
      if (claimedPhotos.has(photoId)) return;
      setClaimedPhotos((prev) => new Set([...prev, photoId]));
      try {
        await addPhotoToProfileAction(photoId);
        toast.success(t('photoAddedToProfile'));
      } catch (error) {
        setClaimedPhotos((prev) => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
        toast.error(error instanceof Error ? error.message : t('failedAddProfile'));
      }
    },
    [claimedPhotos, t],
  );

  // ── Selection + bulk download ──────────────────────────────────────────
  const selection = usePhotoSelection();
  const { isDownloading, downloadSelected } = useBulkPhotoDownload({
    eventId,
    isFreeEvent,
    purchasedPhotoIds,
    bulkDownload,
  });

  // ── AI face-search results ─────────────────────────────────────────────
  const faceSearch = useFaceSearch();
  const bucketed = useMemo(
    () => buildBuckets(faceSearch.matches, items),
    [faceSearch.matches, items],
  );
  // A new search (or returning to the full gallery) starts a clean selection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs intentionally when the search state changes
  useEffect(() => {
    selection.clear();
  }, [faceSearch.matches, selection.clear]);

  // ── "All photos / My photos" filter ────────────────────────────────────
  const [filter, setFilter] = useState<EventPhotoFilter>('all');
  const handleFilterChange = useCallback(
    (value: EventPhotoFilter) => {
      setFilter(value);
      selection.clear();
    },
    [selection.clear],
  );
  const visiblePhotos = useMemo(
    () => (filter === 'mine' ? items.filter((i) => uploadedPhotoIds.has(i.id)) : items),
    [filter, items, uploadedPhotoIds],
  );

  const countLabel = useMemo(() => {
    if (selection.selectedIds.length === 0) return bulkDownload.countNone;
    if (selection.selectedIds.length === 1) return bulkDownload.countOne;
    return bulkDownload.countMany.replace('{n}', String(selection.selectedIds.length));
  }, [selection.selectedIds.length, bulkDownload]);

  // ── Per-photo download (dropdown) ──────────────────────────────────────
  const isPhotoDownloadable = useCallback(
    (photoId: string) => isFreeEvent || purchasedPhotoIds.has(photoId),
    [isFreeEvent, purchasedPhotoIds],
  );

  const handleDownloadPhoto = useCallback(
    async (photoId: string) => {
      if (!isPhotoDownloadable(photoId)) {
        toast.error(menuLabels.downloadNotPurchased);
        return;
      }
      try {
        const url = await getEventPhotoDownloadUrlAction(photoId, eventId);
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.click();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : menuLabels.downloadFailed);
      }
    },
    [isPhotoDownloadable, eventId, menuLabels],
  );

  const handleCartToggle = useCallback(
    (photoId: string) => {
      if (photosInCart.has(photoId)) {
        handleRemoveFromCart(photoId);
      } else {
        handleAddToCart(photoId);
      }
    },
    [photosInCart, handleAddToCart, handleRemoveFromCart],
  );

  const moreMenu = useMemo<PhotoMoreMenuConfig>(
    () => ({
      labels: {
        trigger: menuLabels.trigger,
        download: menuLabels.download,
        addToFavorites: menuLabels.addToFavorites,
        removeFromFavorites: menuLabels.removeFromFavorites,
        addToProfile: menuLabels.addToProfile,
        addedToProfile: menuLabels.addedToProfile,
        addToCart: menuLabels.addToCart,
        removeFromCart: menuLabels.removeFromCart,
        uploadedBy: menuLabels.uploadedBy,
      },
      onDownload: handleDownloadPhoto,
      isDownloadDisabled: (id) => !isPhotoDownloadable(id),
      onFavoriteToggle: handleFavoriteToggle,
      favoritedIds: myPhotos,
      onClaimToProfile: handleClaimToProfile,
      claimedIds: claimedPhotos,
      // Claiming a photo into the profile is only for free photos.
      canClaimToProfile: () => isFreeEvent,
      onCartToggle: handleCartToggle,
      showCartFor: (id) => !isFreeEvent && !purchasedPhotoIds.has(id),
      showUploaderRow: isCollaborative,
    }),
    [
      menuLabels,
      handleDownloadPhoto,
      isPhotoDownloadable,
      handleFavoriteToggle,
      myPhotos,
      handleClaimToProfile,
      claimedPhotos,
      isFreeEvent,
      handleCartToggle,
      purchasedPhotoIds,
      isCollaborative,
    ],
  );

  const renderGrid = (gridItems: PhotoAlbumItem[]) => (
    <PhotoAlbumViewer
      items={gridItems}
      selectionMode={selection.isSelecting}
      selectedIds={selection.selectedIds}
      onToggleSelect={selection.toggle}
      showAddToCart={showAddToCart}
      photosInCart={photosInCart}
      onAddToCart={handleAddToCart}
      onRemoveFromCart={handleRemoveFromCart}
      showAddToPhotos={true}
      photosInMyPhotos={myPhotos}
      onAddToPhotos={handleAddToPhotos}
      onRemoveFromPhotos={handleRemoveFromPhotos}
      showDownload={true}
      onDownload={handleDownloadPhoto}
      moreMenu={moreMenu}
      iconTooltips={iconTooltips}
      imageUnavailableLabel={imageUnavailableLabel}
    />
  );

  const downloadButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => downloadSelected(selection.selectedIds)}
      disabled={selection.selectedIds.length === 0 || isDownloading}
    >
      {isDownloading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {isDownloading ? bulkDownload.preparing : bulkDownload.download}
    </Button>
  );

  // ── AI face-search results view ────────────────────────────────────────
  if (faceSearch.matches !== null) {
    return (
      <div className="space-y-3">
        <FaceSearchResults
          bucketed={bucketed}
          matchCount={faceSearch.matches.length}
          eventIndexingComplete={faceSearch.eventIndexingComplete}
          resultsLabels={resultsLabels}
          renderGrid={renderGrid}
          onTryAgain={faceSearch.openSearch}
          onViewAll={faceSearch.clearMatches}
          toolbar={
            <PhotoSelectionToolbar
              className="sticky top-[var(--header-height)] -mx-4 px-4 md:-mx-6 md:px-6"
              leading={
                <Button type="button" variant="outline" size="sm" onClick={faceSearch.clearMatches}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" />
                  {resultsLabels.viewAllPhotos}
                </Button>
              }
              isSelecting={selection.isSelecting}
              countLabel={countLabel}
              selectLabel={bulkDownload.select}
              clearLabel={bulkDownload.clear}
              onStartSelecting={selection.startSelecting}
              onClear={selection.clear}
            >
              {downloadButton}
            </PhotoSelectionToolbar>
          }
        />
      </div>
    );
  }

  // ── Full gallery ───────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <PhotoSelectionToolbar
          className="sticky top-[var(--header-height)] -mx-4 px-4 md:-mx-6 md:px-6"
          leading={
            isCollaborative && !selection.isSelecting ? (
              <EventPhotoFilterTabs
                value={filter}
                onValueChange={handleFilterChange}
                allLabel={filterLabels.all}
                mineLabel={filterLabels.mine}
              />
            ) : undefined
          }
          isSelecting={selection.isSelecting}
          countLabel={countLabel}
          selectLabel={bulkDownload.select}
          clearLabel={bulkDownload.clear}
          onStartSelecting={selection.startSelecting}
          onClear={selection.clear}
        >
          {downloadButton}
        </PhotoSelectionToolbar>
      )}
      {visiblePhotos.length === 0 && filter === 'mine' ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">{filterLabels.empty}</p>
        </div>
      ) : (
        renderGrid(visiblePhotos)
      )}
    </div>
  );
}
