'use client';

import { Pencil, Trash2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { deleteEventAction } from '@/app/[lang]/dashboard/photographer/events/actions';
import { ConfirmDialog } from '@/components/confirm-dialog';
import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoIconTooltips } from '@/components/photo-icon-buttons';
import { TagTalentDialog } from '@/components/tag-talent-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import { deletePhotoAction } from './edit/actions';

type EventsT = Dictionary['events'];

type EventPhotoAlbumProps = {
  items: PhotoAlbumItem[];
  eventId: string;
  iconTooltips?: Partial<PhotoIconTooltips>;
};

export function EventPhotoAlbum({ items, eventId, iconTooltips }: EventPhotoAlbumProps) {
  const router = useRouter();
  const lp = useLocalizedPath();
  const { t } = useTranslations<EventsT>();
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteEventDialogOpen, setDeleteEventDialogOpen] = useState(false);
  const [isDeleting, startDeleting] = useTransition();
  const [isDeletingEvent, startDeletingEvent] = useTransition();

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

  const confirmDelete = useCallback(async () => {
    startDeleting(async () => {
      try {
        await Promise.all(selectedIds.map((photoId) => deletePhotoAction(photoId, eventId)));
        const noun = selectedIds.length === 1 ? t('photo') : t('photos');
        toast.success(
          t('deletedPhotosToast')
            .replace('{n}', String(selectedIds.length))
            .replace('{noun}', noun),
        );
        setSelectedIds([]);
        setIsSelecting(false);
        router.refresh();
      } catch (error) {
        console.error(error);
        toast.error(error instanceof Error ? error.message : t('failedDeletePhotos'));
      }
    });
  }, [selectedIds, eventId, router, t]);

  const confirmDeleteEvent = useCallback(() => {
    startDeletingEvent(async () => {
      try {
        await deleteEventAction(eventId);
        router.push(lp('/dashboard/photographer/events'));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('failedDeleteEvent'));
      }
    });
  }, [eventId, router, lp, t]);

  const selectedCountLabel = useMemo(() => {
    if (selectedIds.length === 0) return t('noPhotosSelected');
    if (selectedIds.length === 1) return t('onePhotoSelected');
    return t('nPhotosSelected').replace('{n}', String(selectedIds.length));
  }, [selectedIds.length, t]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {!isSelecting && (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsSelecting(true)}>
              {t('selectButton')}
            </Button>
            <Link
              href={`/dashboard/photographer/events/${eventId}/edit`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <Pencil className="mr-2 h-4 w-4" />
              {t('editEvent')}
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteEventDialogOpen(true)}
              disabled={isDeletingEvent}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {isDeletingEvent ? t('deletingLabel') : t('deleteEvent')}
            </Button>
          </div>
        )}
        {isSelecting && (
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <div className="text-sm font-medium">{selectedCountLabel}</div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={clearSelection}>
                {t('clearButton')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDeleteSelected}
                disabled={selectedIds.length === 0 || isDeleting}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {isDeleting ? t('deletingLabel') : t('removeButton')}
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
            </div>
          </div>
        )}
      </div>
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
        iconTooltips={iconTooltips}
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
        variant="destructive"
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={deleteEventDialogOpen}
        onOpenChange={setDeleteEventDialogOpen}
        title={t('deleteConfirmTitle')}
        description={t('deleteConfirmDesc')}
        confirmText={t('confirmButton')}
        cancelText={t('cancelButton')}
        variant="destructive"
        onConfirm={confirmDeleteEvent}
      />
    </div>
  );
}
