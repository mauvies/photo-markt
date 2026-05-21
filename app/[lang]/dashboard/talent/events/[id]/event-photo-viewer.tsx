'use client';

import { Download, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  addPhotoToCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import { type EventPhotoFilter, EventPhotoFilterTabs } from '@/components/event-photo-filter-tabs';
import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoIconTooltips } from '@/components/photo-icon-buttons';
import {
  type BulkDownloadLabels,
  PhotoSelectionToolbar,
} from '@/components/photo-selection-toolbar';
import { Button } from '@/components/ui/button';
import { useOptimisticPhotosInCart } from '@/hooks/use-optimistic-photos-in-cart';
import { downloadEventPhotosZip } from '@/lib/download-zip';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { addPhotoToMyPhotosAction, removePhotoFromMyPhotosAction } from './actions';

type EventPhotoViewerProps = {
  items: PhotoAlbumItem[];
  eventId: string;
  /** Free events let anyone download; paid events restrict to purchased photos. */
  isFreeEvent: boolean;
  /** Collaborative events get the "All photos / My photos" filter. */
  isCollaborative?: boolean;
  /** Photo IDs the current talent uploaded — backs the "My photos" filter. */
  uploadedPhotoIds?: Set<string>;
  /** Labels for the "All photos / My photos" filter (collaborative events). */
  filterLabels: { all: string; mine: string; empty: string };
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

  const handleAddToPhotos = async (photoId: string) => {
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
  };

  const handleRemoveFromPhotos = async (photoId: string) => {
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
  };

  // ── Selection + bulk download ──────────────────────────────────────────
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleToggleSelect = useCallback((photoId: string) => {
    setSelectedIds((current) => {
      const exists = current.includes(photoId);
      const next = exists ? current.filter((id) => id !== photoId) : [...current, photoId];
      setIsSelecting(next.length > 0);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setIsSelecting(false);
  }, []);

  // ── "All photos / My photos" filter ────────────────────────────────────
  const [filter, setFilter] = useState<EventPhotoFilter>('all');
  const handleFilterChange = useCallback(
    (value: EventPhotoFilter) => {
      setFilter(value);
      clearSelection();
    },
    [clearSelection],
  );
  const visiblePhotos = useMemo(
    () => (filter === 'mine' ? items.filter((i) => uploadedPhotoIds.has(i.id)) : items),
    [filter, items, uploadedPhotoIds],
  );

  const countLabel = useMemo(() => {
    if (selectedIds.length === 0) return bulkDownload.countNone;
    if (selectedIds.length === 1) return bulkDownload.countOne;
    return bulkDownload.countMany.replace('{n}', String(selectedIds.length));
  }, [selectedIds.length, bulkDownload]);

  const handleDownloadSelected = useCallback(async () => {
    if (selectedIds.length === 0 || isDownloading) return;
    // Free event → everything is downloadable. Paid → only purchased photos;
    // the rest are skipped (the server re-verifies regardless).
    const downloadable = isFreeEvent
      ? selectedIds
      : selectedIds.filter((id) => purchasedPhotoIds.has(id));
    const skipped = selectedIds.length - downloadable.length;
    if (downloadable.length === 0) {
      toast.error(bulkDownload.nonePurchased);
      return;
    }
    setIsDownloading(true);
    try {
      await downloadEventPhotosZip(eventId, downloadable);
      if (skipped > 0) {
        toast.success(
          bulkDownload.skipped
            .replace('{n}', String(downloadable.length))
            .replace('{m}', String(skipped)),
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : bulkDownload.failed);
    } finally {
      setIsDownloading(false);
    }
  }, [selectedIds, isDownloading, isFreeEvent, purchasedPhotoIds, eventId, bulkDownload]);

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <PhotoSelectionToolbar
          className="sticky top-[var(--header-height)] -mx-4 px-4 md:-mx-6 md:px-6"
          leading={
            isCollaborative ? (
              <EventPhotoFilterTabs
                value={filter}
                onValueChange={handleFilterChange}
                allLabel={filterLabels.all}
                mineLabel={filterLabels.mine}
              />
            ) : undefined
          }
          isSelecting={isSelecting}
          countLabel={countLabel}
          selectLabel={bulkDownload.select}
          clearLabel={bulkDownload.clear}
          onStartSelecting={() => setIsSelecting(true)}
          onClear={clearSelection}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownloadSelected}
            disabled={selectedIds.length === 0 || isDownloading}
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
          selectionMode={isSelecting}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          showAddToCart={showAddToCart}
          photosInCart={photosInCart}
          onAddToCart={handleAddToCart}
          onRemoveFromCart={handleRemoveFromCart}
          showAddToPhotos={true}
          photosInMyPhotos={myPhotos}
          onAddToPhotos={handleAddToPhotos}
          onRemoveFromPhotos={handleRemoveFromPhotos}
          iconTooltips={iconTooltips}
          imageUnavailableLabel={imageUnavailableLabel}
        />
      )}
    </div>
  );
}
