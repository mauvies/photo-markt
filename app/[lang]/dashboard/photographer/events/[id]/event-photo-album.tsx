'use client';

import { Download, Trash2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { PhotoAlbumItem } from '@/components/photo-album-viewer';
import { PhotoGallery, type PhotoGalleryBulkAction } from '@/components/photo-gallery';
import type { PhotoIconTooltips, PhotoMoreMenuConfig } from '@/components/photo-icon-buttons';
import { TagTalentDialog } from '@/components/tag-talent-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { downloadEventPhotosZip } from '@/lib/download-zip';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { getPhotoDownloadUrlAction } from './actions';
import { deletePhotoAction, updatePhotoLabelAction } from './edit/actions';

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

  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // The photo ids the currently-open dialog acts on (a bulk selection or a
  // single photo from the 3-dot menu).
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  // Bumped to make PhotoGallery clear its selection after a tag/delete.
  const [selectionResetKey, setSelectionResetKey] = useState(0);

  // Edit-code dialog state.
  const [editCodeOpen, setEditCodeOpen] = useState(false);
  const [editCodePhotoId, setEditCodePhotoId] = useState<string | null>(null);
  const [editCodeValue, setEditCodeValue] = useState('');
  const [editCodePlaceholder, setEditCodePlaceholder] = useState('');
  const [editCodeSaving, setEditCodeSaving] = useState(false);

  const handleEditCode = useCallback(
    (photoId: string) => {
      const item = items.find((i) => i.id === photoId);
      if (!item) return;
      setEditCodePhotoId(photoId);
      setEditCodeValue(item.label ?? '');
      setEditCodePlaceholder(item.sequence != null ? `#${item.sequence}` : '');
      setEditCodeOpen(true);
    },
    [items],
  );

  const handleSaveCode = useCallback(async () => {
    if (!editCodePhotoId) return;
    const value = editCodeValue.trim();
    setEditCodeSaving(true);
    try {
      await updatePhotoLabelAction(editCodePhotoId, eventId, value);
      // Optimistic — reflect the new label immediately; router.refresh() reconciles.
      setItems((prev) =>
        prev.map((it) =>
          it.id === editCodePhotoId ? { ...it, label: value === '' ? null : value } : it,
        ),
      );
      setEditCodeOpen(false);
      toast.success(t('editCodeSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('editCodeError'));
    } finally {
      setEditCodeSaving(false);
    }
  }, [editCodePhotoId, editCodeValue, eventId, t]);

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
    setItems((prev) => prev.filter((it) => !ids.includes(it.id)));
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
      clear: t('clearButton'),
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
        items={items}
        selectionResetKey={selectionResetKey}
        bulkActions={bulkActions}
        labels={selectionLabels}
        toolbarClassName="sticky top-0 -mx-4 px-4"
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
          onEditCode: handleEditCode,
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
      <Dialog
        open={editCodeOpen}
        onOpenChange={(open) => {
          if (!editCodeSaving) setEditCodeOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('editCodeTitle')}</DialogTitle>
            <DialogDescription>{t('editCodeDesc')}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveCode();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="photo-code-input">{t('editCodeInputLabel')}</Label>
              <Input
                id="photo-code-input"
                value={editCodeValue}
                onChange={(e) => setEditCodeValue(e.target.value)}
                placeholder={editCodePlaceholder}
                maxLength={50}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditCodeOpen(false)}
                disabled={editCodeSaving}
              >
                {t('cancelButton')}
              </Button>
              <Button type="submit" disabled={editCodeSaving}>
                {t('editCodeSave')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
