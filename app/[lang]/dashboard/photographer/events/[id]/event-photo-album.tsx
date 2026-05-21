'use client';

import { Download, Loader2, Trash2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoIconTooltips, PhotoMoreMenuConfig } from '@/components/photo-icon-buttons';
import { PhotoSelectionToolbar } from '@/components/photo-selection-toolbar';
import { TagTalentDialog } from '@/components/tag-talent-dialog';
import { Button } from '@/components/ui/button';
import { downloadEventPhotosZip } from '@/lib/download-zip';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { getPhotoDownloadUrlAction } from './actions';
import { deletePhotoAction } from './edit/actions';

type EventsT = Dictionary['events'];

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
};

export function EventPhotoAlbum({
  items: initialItems,
  eventId,
  isCollaborative = false,
  uploaderLabels,
  iconTooltips,
  imageUnavailableLabel,
}: EventPhotoAlbumProps) {
  const router = useRouter();
  const { t } = useTranslations<EventsT>();
  // Local copy of the grid so a delete can drop tiles instantly (optimistic),
  // then reconcile with the server via router.refresh(). Re-seeded whenever
  // the server sends fresh items.
  const [items, setItems] = useState(initialItems);
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
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

  const handleTagSuccess = useCallback(() => {
    setSelectedIds([]);
    setIsSelecting(false);
    router.refresh();
  }, [router]);

  const handleUntag = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleTagSinglePhoto = useCallback((photoId: string) => {
    setSelectedIds([photoId]);
    setTagDialogOpen(true);
  }, []);

  const handleDeleteSinglePhoto = useCallback((photoId: string) => {
    setSelectedIds([photoId]);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    setDeleteDialogOpen(true);
  }, [selectedIds.length]);

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

  const handleDownloadSelected = useCallback(async () => {
    if (selectedIds.length === 0 || isDownloading) return;
    setIsDownloading(true);
    try {
      // The photographer owns the event — the route allows every photo.
      await downloadEventPhotosZip(eventId, selectedIds);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloadFailed'));
    } finally {
      setIsDownloading(false);
    }
  }, [selectedIds, isDownloading, eventId, t]);

  const confirmDelete = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((photoId) => deletePhotoAction(photoId, eventId)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('failedDeletePhotos'));
      throw error; // keep the ConfirmDialog open so the user can retry
    }
    // Optimistic removal — drop the tiles now; router.refresh() reconciles.
    setItems((prev) => prev.filter((it) => !ids.includes(it.id)));
    toast.success(
      t('deletedPhotosToast')
        .replace('{n}', String(ids.length))
        .replace('{noun}', ids.length === 1 ? t('photo') : t('photos')),
    );
    setSelectedIds([]);
    setIsSelecting(false);
    router.refresh();
  }, [selectedIds, eventId, router, t]);

  const selectedCountLabel = useMemo(() => {
    if (selectedIds.length === 0) return t('noPhotosSelected');
    if (selectedIds.length === 1) return t('onePhotoSelected');
    return t('nPhotosSelected').replace('{n}', String(selectedIds.length));
  }, [selectedIds.length, t]);

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

  const hasItems = items.length > 0;

  return (
    <div className="space-y-3">
      {(hasItems || isSelecting) && (
        <PhotoSelectionToolbar
          className="sticky top-0 -mx-4 px-4"
          isSelecting={isSelecting}
          countLabel={selectedCountLabel}
          selectLabel={t('selectButton')}
          clearLabel={t('clearButton')}
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
            {isDownloading ? t('preparingDownload') : t('download')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDeleteSelected}
            disabled={selectedIds.length === 0}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('removeButton')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => setTagDialogOpen(true)}
            disabled={selectedIds.length === 0}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            {t('tagTalentButton')}
          </Button>
        </PhotoSelectionToolbar>
      )}
      <PhotoAlbumViewer
        items={items}
        selectionMode={isSelecting}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onTagPhoto={handleTagSinglePhoto}
        onUntag={handleUntag}
        showRemove={true}
        showTagTalent={true}
        onRemove={handleDeleteSinglePhoto}
        onTagTalent={handleTagSinglePhoto}
        moreMenu={moreMenu}
        uploaderLabels={uploaderLabels}
        iconTooltips={iconTooltips}
        imageUnavailableLabel={imageUnavailableLabel}
      />
      <TagTalentDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        photoIds={selectedIds}
        onSuccess={handleTagSuccess}
      />
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('deletePhotosTitle')}
        description={t('deletePhotosDesc')
          .replace('{n}', String(selectedIds.length))
          .replace('{noun}', selectedIds.length === 1 ? t('photo') : t('photos'))}
        confirmText={t('confirmButton')}
        cancelText={t('cancelButton')}
        pendingText={t('deletingLabel')}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
