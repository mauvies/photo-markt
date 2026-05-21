'use client';

import { Download, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  addPhotoToCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import { getEventPhotoDownloadUrlAction } from '@/app/[lang]/events/[shareCode]/actions';
import { type EventPhotoFilter, EventPhotoFilterTabs } from '@/components/event-photo-filter-tabs';
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
import { addPhotoToMyPhotosAction, removePhotoFromMyPhotosAction } from './actions';

/** Localized copy for the per-photo "more options" dropdown. */
export type PhotoMenuLabels = {
  trigger: string;
  download: string;
  saveToProfile: string;
  saveToPhotos: string;
  removeFromLibrary: string;
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
  purchasedPhotoIds?: Set<string>;
  bulkDownload: BulkDownloadLabels;
  showAddToCart?: boolean;
  photosInCart?: Set<string>;
  photosInMyPhotos?: Set<string>;
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
  purchasedPhotoIds = new Set(),
  bulkDownload,
  showAddToCart = false,
  photosInCart: initialPhotosInCart = new Set(),
  photosInMyPhotos: initialPhotosInMyPhotos = new Set(),
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
  }>();

  // Optimistic state for "my photos" — initialized from server prop, updates instantly on click
  const [myPhotos, setMyPhotos] = useState<Set<string>>(initialPhotosInMyPhotos);

  // Sync when server refreshes props (e.g. after router.refresh)
  useEffect(() => {
    setMyPhotos(initialPhotosInMyPhotos);
  }, [initialPhotosInMyPhotos]);

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

  // ── Selection + bulk download ──────────────────────────────────────────
  const selection = usePhotoSelection();
  const { isDownloading, downloadSelected } = useBulkPhotoDownload({
    eventId,
    isFreeEvent,
    purchasedPhotoIds,
    bulkDownload,
  });

  // ── "All photos / My photos" filter ────────────────────────────────────
  const [filter, setFilter] = useState<EventPhotoFilter>('all');
  const handleFilterChange = useCallback(
    (value: EventPhotoFilter) => {
      setFilter(value);
      selection.clear();
    },
    [selection],
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

  // ── Per-photo "more options" dropdown ──────────────────────────────────
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
        // The signed URL carries Content-Disposition: attachment.
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

  const handleSaveToggle = useCallback(
    (photoId: string) => {
      if (myPhotos.has(photoId)) {
        void handleRemoveFromPhotos(photoId).catch(() => {});
      } else {
        void handleAddToPhotos(photoId).catch(() => {});
      }
    },
    [myPhotos, handleAddToPhotos, handleRemoveFromPhotos],
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
        saveToProfile: menuLabels.saveToProfile,
        saveToPhotos: menuLabels.saveToPhotos,
        removeFromLibrary: menuLabels.removeFromLibrary,
        addToCart: menuLabels.addToCart,
        removeFromCart: menuLabels.removeFromCart,
        uploadedBy: menuLabels.uploadedBy,
      },
      onDownload: handleDownloadPhoto,
      isDownloadDisabled: (id) => !isPhotoDownloadable(id),
      onSaveToggle: handleSaveToggle,
      savedIds: myPhotos,
      saveLabelVariant: isFreeEvent ? 'profile' : 'photos',
      onCartToggle: handleCartToggle,
      showCartFor: (id) => !isFreeEvent && !purchasedPhotoIds.has(id),
      showUploaderRow: isCollaborative,
    }),
    [
      menuLabels,
      handleDownloadPhoto,
      isPhotoDownloadable,
      handleSaveToggle,
      myPhotos,
      isFreeEvent,
      handleCartToggle,
      purchasedPhotoIds,
      isCollaborative,
    ],
  );

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
        </PhotoSelectionToolbar>
      )}
      {visiblePhotos.length === 0 && filter === 'mine' ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">{filterLabels.empty}</p>
        </div>
      ) : (
        <PhotoAlbumViewer
          items={visiblePhotos}
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
      )}
    </div>
  );
}
