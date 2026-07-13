'use client';

import { Download, Trash2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EventPhotoCountLabel } from '@/components/event-photo-count-label';
import type { PhotoAlbumItem } from '@/components/photo-album-viewer';
import { PhotoGallery, type PhotoGalleryBulkAction } from '@/components/photo-gallery';
import type { PhotoIconTooltips, PhotoMoreMenuConfig } from '@/components/photo-icon-buttons';
import { TagTalentDialog } from '@/components/tag-talent-dialog';
import { useLoadMorePhotos } from '@/hooks/use-load-more-photos';
import { downloadEventPhotosZip } from '@/lib/download-zip';
import { filterEventPhotoPages } from '@/lib/event-photo-filter';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { getPhotoDownloadUrlAction, loadMoreOwnerEventPhotos } from './actions';
import { deletePhotoAction } from './edit/actions';

type EventsT = Dictionary['events'];

/** Stable empty set — the owner grid has no "My photos" filter. */
const NO_MY_PHOTO_IDS: Set<string> = new Set();

type UploaderLabels = {
  tooltip: string;
  popoverHeading: string;
  guestLabel: string;
  authenticatedLabel: string;
};

type EventPhotoAlbumProps = {
  items: PhotoAlbumItem[];
  eventId: string;
  /** Collaborative events get the per-photo 3-dot "more options" menu. */
  isCollaborative?: boolean;
  /** Labels for the per-photo "Uploaded by" badge (collaborative events). */
  uploaderLabels?: UploaderLabels;
  iconTooltips?: Partial<PhotoIconTooltips>;
  imageUnavailableLabel: string;
  /** True non-rejected photo total for the event (server-computed) — the
   * toolbar count reflects the whole event, not the loaded page (T-104). */
  totalCount: number;
  /** Optional node for the toolbar's left slot (same row as "Select"). When
   * set (moderation view: the Approved/Pending tab switcher, T-113) it replaces
   * the standalone photo count — the tab labels already carry the counts. */
  toolbarLeading?: ReactNode;
  /** Whether more photos exist beyond the first batch (drives "Load more"). */
  initialHasMore?: boolean;
  /** "Load more" button label. */
  loadMoreLabel: string;
  /** Toast shown when a "Load more" fetch fails. */
  loadMoreErrorLabel: string;
};

export function EventPhotoAlbum({
  items: initialItems,
  eventId,
  isCollaborative = false,
  uploaderLabels,
  iconTooltips,
  imageUnavailableLabel,
  totalCount,
  toolbarLeading,
  initialHasMore = false,
  loadMoreLabel,
  loadMoreErrorLabel,
}: EventPhotoAlbumProps) {
  const router = useRouter();
  const { t } = useTranslations<EventsT>();

  // Paginated grid — server sends the first batch, "Load more" appends the
  // rest. `deletedIds` drops tiles instantly on delete (optimistic); the hook
  // re-seeds from the server on router.refresh().
  const {
    items: accumulated,
    pages: gridPages,
    hasMore,
    isLoadingMore,
    loadMore,
  } = useLoadMorePhotos<PhotoAlbumItem>({
    initialItems,
    initialHasMore,
    initialOffset: initialItems.length,
    fetchMore: (offset) => loadMoreOwnerEventPhotos(eventId, offset),
    onError: () => toast.error(loadMoreErrorLabel),
  });
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  // Flat list — backs the local handlers (share/download by id). The grid is
  // driven by `gridBatches` so each load-more page renders as its own segment
  // (no re-flow / scroll-jump on append). No "mine" filter on the owner view.
  const items = useMemo(
    () => accumulated.filter((i) => !deletedIds.has(i.id)),
    [accumulated, deletedIds],
  );
  const gridBatches = useMemo(
    () =>
      filterEventPhotoPages(gridPages, { deletedIds, filter: 'all', myPhotoIds: NO_MY_PHOTO_IDS }),
    [gridPages, deletedIds],
  );

  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // The photo ids the currently-open dialog acts on (a bulk selection or a
  // single photo from the 3-dot menu).
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  // Bumped to make PhotoGallery clear its selection after a tag/delete.
  const [selectionResetKey, setSelectionResetKey] = useState(0);

  const handleUntag = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleTagSuccess = useCallback(() => {
    setSelectionResetKey((k) => k + 1);
    router.refresh();
  }, [router]);

  const handleTagSinglePhoto = useCallback((photoId: string) => {
    setPendingIds([photoId]);
    setTagDialogOpen(true);
  }, []);

  const handleDeleteSinglePhoto = useCallback((photoId: string) => {
    setPendingIds([photoId]);
    setDeleteDialogOpen(true);
  }, []);

  const handleSharePhoto = useCallback(
    async (photoId: string) => {
      const item = items.find((i) => i.id === photoId);
      if (!item) return;
      try {
        await navigator.clipboard.writeText(item.url);
        toast.success(t('shareCopied'));
      } catch (error) {
        console.error(error);
      }
    },
    [items, t],
  );

  const handleDownloadPhoto = useCallback(
    async (photoId: string) => {
      try {
        const url = await getPhotoDownloadUrlAction(photoId, eventId);
        // The signed URL carries Content-Disposition: attachment, so this
        // saves the file even though it's a cross-origin Supabase URL.
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.click();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('downloadFailed'));
      }
    },
    [eventId, t],
  );

  const handleDownloadSelected = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0 || isDownloading) return;
      setIsDownloading(true);
      try {
        // The photographer owns the event — the route allows every photo.
        await downloadEventPhotosZip(eventId, ids);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('downloadFailed'));
      } finally {
        setIsDownloading(false);
      }
    },
    [isDownloading, eventId, t],
  );

  const confirmDelete = useCallback(async () => {
    const ids = [...pendingIds];
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((photoId) => deletePhotoAction(photoId, eventId)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('failedDeletePhotos'));
      throw error; // keep the ConfirmDialog open so the user can retry
    }
    // Optimistic removal — drop the tiles now; router.refresh() reconciles.
    setDeletedIds((prev) => {
      const next = new Set(prev);
      for (const photoId of ids) next.add(photoId);
      return next;
    });
    toast.success(
      t('deletedPhotosToast')
        .replace('{n}', String(ids.length))
        .replace('{noun}', ids.length === 1 ? t('photo') : t('photos')),
    );
    setSelectionResetKey((k) => k + 1);
    router.refresh();
  }, [pendingIds, eventId, router, t]);

  // Collaborative events only — the 3-dot menu replaces the standalone
  // tag/delete icons on each tile.
  const moreMenu: PhotoMoreMenuConfig | undefined = useMemo(
    () =>
      isCollaborative
        ? {
            labels: {
              trigger: t('moreOptions'),
              delete: t('deletePhoto'),
              tagPeople: t('tagPeople'),
              share: t('share'),
              download: t('download'),
            },
            onDelete: handleDeleteSinglePhoto,
            onTagPeople: handleTagSinglePhoto,
            onShare: handleSharePhoto,
            onDownload: handleDownloadPhoto,
          }
        : undefined,
    [
      isCollaborative,
      t,
      handleDeleteSinglePhoto,
      handleTagSinglePhoto,
      handleSharePhoto,
      handleDownloadPhoto,
    ],
  );

  const actionBarLabels = useMemo(
    () => ({
      download: t('download'),
      addToFavorites: t('addToFavorites'),
      removeFromFavorites: t('removeFromFavorites'),
      addToProfile: t('addToProfile'),
      addedToProfile: t('addedToProfile'),
      addToCart: t('addToCartMenuItem'),
      removeFromCart: t('removeFromCartMenuItem'),
      remove: t('deletePhoto'),
      tagPeople: t('tagPeople'),
      uploadedBy: t('uploadedByMenuLabel'),
    }),
    [t],
  );

  const bulkActions = useMemo<PhotoGalleryBulkAction[]>(
    () => [
      {
        key: 'download',
        label: t('download'),
        icon: Download,
        onRun: handleDownloadSelected,
        isPending: isDownloading,
      },
      {
        key: 'delete',
        label: t('removeButton'),
        icon: Trash2,
        onRun: (ids) => {
          setPendingIds(ids);
          setDeleteDialogOpen(true);
        },
      },
      {
        key: 'tag',
        label: t('tagTalentButton'),
        icon: UserPlus,
        onRun: (ids) => {
          setPendingIds(ids);
          setTagDialogOpen(true);
        },
      },
    ],
    [t, handleDownloadSelected, isDownloading],
  );

  const selectionLabels = useMemo(
    () => ({
      select: t('selectButton'),
      countNone: t('noPhotosSelected'),
      countOne: t('onePhotoSelected'),
      countMany: t('nPhotosSelected'),
      exitSelection: t('exitSelection'),
    }),
    [t],
  );

  return (
    <div className="space-y-3">
      <PhotoGallery
        itemBatches={gridBatches}
        selectionResetKey={selectionResetKey}
        bulkActions={bulkActions}
        labels={selectionLabels}
        toolbarLeading={
          toolbarLeading ??
          (totalCount > 0 ? (
            <EventPhotoCountLabel label={t('photosCount').replace('{n}', String(totalCount))} />
          ) : undefined)
        }
        toolbarClassName="sticky top-0"
        loadMore={{
          hasMore,
          isLoading: isLoadingMore,
          onLoadMore: loadMore,
          label: loadMoreLabel,
        }}
        galleryProps={{
          onTagPhoto: handleTagSinglePhoto,
          onUntag: handleUntag,
          showRemove: true,
          showTagTalent: true,
          onRemove: handleDeleteSinglePhoto,
          onTagTalent: handleTagSinglePhoto,
          showDownload: true,
          onDownload: handleDownloadPhoto,
          moreMenu,
          uploaderLabels,
          iconTooltips,
          imageUnavailableLabel,
          lightboxActionBar: 'bottom',
          actionBarLabels,
        }}
      />
      <TagTalentDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        photoIds={pendingIds}
        onSuccess={handleTagSuccess}
      />
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('deletePhotosTitle')}
        description={t('deletePhotosDesc')
          .replace('{n}', String(pendingIds.length))
          .replace('{noun}', pendingIds.length === 1 ? t('photo') : t('photos'))}
        confirmText={t('confirmButton')}
        cancelText={t('cancelButton')}
        pendingText={t('deletingLabel')}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
