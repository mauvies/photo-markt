'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { removePhotosFromMyPhotosAction } from '@/app/[lang]/dashboard/talent/photos/actions';
import { type PhotoAlbumItem, PhotoGallery } from '@/components/photo-gallery';
import type { PhotoMoreMenuConfig } from '@/components/photo-icon-buttons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { getPhotoDownloadUrl } from './actions';

type ProfilePhotoViewerProps = {
  items: PhotoAlbumItem[];
  photoMetadata: Record<
    string,
    {
      download_url: string | null;
      event_name: string | null;
      event_date: string | null;
      photographer_display_name: string | null;
      photographer_username: string | null;
    }
  >;
};

export function ProfilePhotoViewer({ items, photoMetadata }: ProfilePhotoViewerProps) {
  const router = useRouter();
  const { t } = useTranslations<{
    downloadStarted: string;
    downloadFailed: string;
    downloadError: string;
    linkCopied: string;
    shared: string;
    shareFailed: string;
    removePhotoTitle: string;
    removePhotoDesc: string;
    removePhotoConfirm: string;
    removePhotoSuccess: string;
    removePhotoFailed: string;
    downloadTooltip: string;
    shareTooltip: string;
    deleteTooltip: string;
    moreOptions: string;
    imageUnavailable: string;
  }>();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleDownload = useCallback(
    async (photoId: string) => {
      const metadata = photoMetadata[photoId];
      if (!metadata?.download_url) {
        toast.error('Download URL not available');
        return;
      }
      try {
        const downloadUrl = await getPhotoDownloadUrl(metadata.download_url);
        if (!downloadUrl) {
          toast.error(t('downloadFailed'));
          return;
        }
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error('Failed to fetch image');
        }
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `photo-${photoId}.jpg`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
        }, 100);
        toast.success(t('downloadStarted'));
      } catch (error) {
        console.error('Download error:', error);
        toast.error(error instanceof Error ? error.message : t('downloadError'));
      }
    },
    [photoMetadata, t],
  );

  const handleShare = useCallback(
    async (photoId: string) => {
      if (!photoMetadata[photoId]) return;
      const baseUrl = window.location.origin + window.location.pathname;
      const shareUrl = `${baseUrl}#photo-${photoId}`;
      try {
        if (navigator.share && navigator.canShare({ url: shareUrl })) {
          await navigator.share({ url: shareUrl });
          toast.success(t('shared'));
        } else {
          await navigator.clipboard.writeText(shareUrl);
          toast.success(t('linkCopied'));
        }
      } catch (error) {
        // User cancelled — only surface a real failure.
        if (error instanceof Error && error.name !== 'AbortError') {
          try {
            await navigator.clipboard.writeText(shareUrl);
            toast.success(t('linkCopied'));
          } catch {
            toast.error(t('shareFailed'));
          }
        }
      }
    },
    [photoMetadata, t],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      await removePhotosFromMyPhotosAction([deleteConfirm]);
      toast.success(t('removePhotoSuccess'));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('removePhotoFailed'));
    } finally {
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, router, t]);

  const moreMenu = useMemo<PhotoMoreMenuConfig>(
    () => ({
      labels: {
        trigger: t('moreOptions'),
        download: t('downloadTooltip'),
        share: t('shareTooltip'),
        delete: t('deleteTooltip'),
      },
      onDownload: (id) => {
        void handleDownload(id);
      },
      isDownloadDisabled: (id) => !photoMetadata[id]?.download_url,
      onShare: (id) => {
        void handleShare(id);
      },
      onDelete: (id) => setDeleteConfirm(id),
    }),
    [t, handleDownload, handleShare, photoMetadata],
  );

  const galleryProps = useMemo(
    () => ({
      moreMenu,
      showDownload: true,
      // Hide the lightbox Download for photos without a ready download URL —
      // consistent with the 3-dot menu's `isDownloadDisabled`.
      isPhotoDownloadable: (id: string) => Boolean(photoMetadata[id]?.download_url),
      onDownload: (id: string) => {
        void handleDownload(id);
      },
      showRemove: true,
      onRemove: (id: string) => setDeleteConfirm(id),
      onShare: (id: string) => {
        void handleShare(id);
      },
      imageUnavailableLabel: t('imageUnavailable'),
      lightboxActionBar: 'bottom' as const,
      actionBarLabels: {
        download: t('downloadTooltip'),
        remove: t('deleteTooltip'),
      },
    }),
    [moreMenu, handleDownload, handleShare, photoMetadata, t],
  );

  return (
    <>
      <PhotoGallery items={items} selectable={false} galleryProps={galleryProps} />

      <AlertDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removePhotoTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('removePhotoDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDeleteConfirm()}>
              {t('removePhotoConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
