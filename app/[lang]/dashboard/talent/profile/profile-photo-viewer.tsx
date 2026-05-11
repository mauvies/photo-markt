'use client';

import { Download, ImageOff, MoreVertical, Share2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Photo, type RenderPhotoContext, RowsPhotoAlbum } from 'react-photo-album';
import { toast } from 'sonner';
import { removePhotosFromMyPhotosAction } from '@/app/[lang]/dashboard/talent/photos/actions';
import { PhotoLightbox, type PhotoLightboxItem } from '@/components/photo-lightbox';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import { getPhotoDownloadUrl } from './actions';
import 'react-photo-album/rows.css';

type ProfilePhotoViewerProps = {
  items: Array<{
    id: string;
    url: string;
    alt?: string;
  }>;
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
  // -1 when the lightbox is closed; otherwise the index of the open photo.
  // Derived from the URL by the parent (see `usePhotoLightboxUrl`).
  currentIndex: number;
  // Fired on grid click — opens the lightbox and pushes `?photo=…`.
  onOpenPhoto: (photoId: string) => void;
  // Fired on next/prev inside the lightbox — replaces the URL param.
  onSwitchPhoto: (photoId: string) => void;
  // Fired on lightbox close — pops/clears the URL param.
  onClose: () => void;
};

export function ProfilePhotoViewer({
  items,
  photoMetadata,
  currentIndex,
  onOpenPhoto,
  onSwitchPhoto,
  onClose,
}: ProfilePhotoViewerProps) {
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
  const [dimensions, setDimensions] = useState<Record<string, { width: number; height: number }>>(
    {},
  );
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  // Per-tile image load state — drives the skeleton/fallback swap inside
  // `renderExtras` and the image fade-in via `componentsProps.image`.
  const [loadStates, setLoadStates] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({});

  useEffect(() => {
    items.forEach((item) => {
      if (dimensions[item.id]) return;
      if (!item.url) {
        console.warn(`Photo ${item.id} has no URL`);
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        const width = img.naturalWidth || 1600;
        const height = img.naturalHeight || 1066;
        setDimensions((prev) => {
          if (prev[item.id]) return prev;
          return { ...prev, [item.id]: { width, height } };
        });
      };
      img.onerror = () => {
        setDimensions((prev) => {
          if (prev[item.id]) return prev;
          return {
            ...prev,
            [item.id]: {
              width: 1600,
              height: 1066,
            },
          };
        });
      };
      img.src = item.url;
    });
  }, [items, dimensions]);

  const photos = useMemo(() => {
    return items.map((item) => {
      const dim = dimensions[item.id] ?? { width: 1600, height: 1066 };
      return {
        id: item.id,
        src: item.url,
        alt: item.alt,
        width: dim.width,
        height: dim.height,
      };
    });
  }, [items, dimensions]);

  const lightboxItems: PhotoLightboxItem[] = useMemo(() => {
    return items.map((item) => {
      const dim = dimensions[item.id] ?? { width: 1600, height: 1066 };
      return {
        id: item.id,
        url: item.url,
        alt: item.alt,
        width: dim.width,
        height: dim.height,
      };
    });
  }, [items, dimensions]);

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

        // Fetch the image as a blob
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error('Failed to fetch image');
        }

        const blob = await response.blob();

        // Create a blob URL and trigger download
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `photo-${photoId}.jpg`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the blob URL after a short delay
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
      const metadata = photoMetadata[photoId];
      if (!metadata) return;

      try {
        // Create URL with photo ID as hash - ensure it's clean
        const baseUrl = window.location.origin + window.location.pathname;
        const shareUrl = `${baseUrl}#photo-${photoId}`;

        // Use Web Share API if available
        if (navigator.share) {
          // Only share the URL to prevent any text from being appended to it
          // Some browsers/apps may concatenate text and URL incorrectly
          const shareData: ShareData = {
            url: shareUrl,
          };

          if (navigator.canShare(shareData)) {
            await navigator.share(shareData);
            toast.success(t('shared'));
          } else {
            // Fallback: copy to clipboard
            await navigator.clipboard.writeText(shareUrl);
            toast.success(t('linkCopied'));
          }
        } else {
          // Fallback: copy to clipboard
          await navigator.clipboard.writeText(shareUrl);
          toast.success(t('linkCopied'));
        }
      } catch (error) {
        // User cancelled or error - fallback to clipboard
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Share error:', error);
          // Try to copy URL as fallback
          try {
            const baseUrl = window.location.origin + window.location.pathname;
            const shareUrl = `${baseUrl}#photo-${photoId}`;
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

  const extractPhotoId = useCallback((photo: Photo & { id?: string }) => {
    if (typeof photo.id === 'string' && photo.id.length > 0) return photo.id;
    if (typeof photo.key === 'string' && photo.key.length > 0) return photo.key;
    return photo.src;
  }, []);

  const renderExtras = useCallback(
    (_props: object, { photo }: RenderPhotoContext<Photo & { id?: string }>) => {
      const photoId = extractPhotoId(photo);
      const state = loadStates[photoId] ?? 'loading';

      // Hide the action icons until the underlying image is ready so they
      // don't float over an empty skeleton.
      if (state === 'loading') {
        return <Skeleton className="absolute inset-0 rounded-lg" />;
      }
      if (state === 'error') {
        return (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
            <ImageOff className="h-8 w-8 opacity-40" aria-hidden />
            <span className="text-xs">{t('imageUnavailable')}</span>
          </div>
        );
      }

      const metadata = photoMetadata[photoId];
      const canDownload = Boolean(metadata?.download_url);

      // Matches the activity/visibility overlay badges used elsewhere on
      // photo tiles — keeps the action affordance visually consistent.
      const triggerClass =
        'pointer-events-auto flex size-7 items-center justify-center rounded-full bg-gray-900/60 backdrop-blur-sm text-white shadow-sm transition-colors hover:bg-gray-900/80 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70';

      return (
        <div className={cn('absolute inset-0 flex flex-col items-end justify-start p-2')}>
          {/* Single "more options" trigger (top right) */}
          <div className="relative z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('moreOptions')}
                  className={triggerClass}
                  onClick={(e) => {
                    // Prevent the grid's click handler from opening the
                    // lightbox when the user taps the menu trigger.
                    e.stopPropagation();
                  }}
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                // Touch targets in shadcn New York are min-h-8 (32px); the
                // gap-2 + padding gives ~40-44px effective tap height, which
                // is comfortable on mobile.
                className="w-44"
                onClick={(e) => e.stopPropagation()}
              >
                {canDownload && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      void handleDownload(photoId);
                    }}
                  >
                    <Download className="size-4" aria-hidden />
                    {t('downloadTooltip')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    void handleShare(photoId);
                  }}
                >
                  <Share2 className="size-4" aria-hidden />
                  {t('shareTooltip')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    setDeleteConfirm(photoId);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t('deleteTooltip')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      );
    },
    [extractPhotoId, loadStates, photoMetadata, handleShare, handleDownload, t],
  );

  return (
    <>
      {/* Photo grid with same style as /dashboard/talent/photos */}
      <div className="w-full max-w-full min-w-0">
        <RowsPhotoAlbum
          photos={photos}
          targetRowHeight={250}
          rowConstraints={{ singleRowMaxHeight: 250 }}
          spacing={10}
          render={{
            extras: renderExtras,
            // The default react-photo-album button slot renders a real
            // <button>, but renderExtras embeds a DropdownMenuTrigger
            // (Radix's button) inside the tile — nested buttons are invalid
            // HTML and trigger a hydration error. Render the tile as a
            // div[role="button"] instead, mirroring components/photo-album-viewer.tsx.
            button: (props) => {
              const { onClick, className: propsClassName, ...restProps } = props;
              return (
                // biome-ignore lint/a11y/useSemanticElements: intentional div to avoid nested buttons
                <div
                  {...(restProps as React.HTMLAttributes<HTMLDivElement>)}
                  onClick={
                    onClick
                      ? (e: React.MouseEvent<HTMLDivElement>) =>
                          onClick(e as unknown as React.MouseEvent<HTMLButtonElement>)
                      : undefined
                  }
                  onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'group relative flex h-full w-full overflow-hidden rounded-lg bg-muted p-0 text-left focus:outline-none focus:ring-2 focus:ring-ring/30 cursor-zoom-in',
                    propsClassName,
                  )}
                />
              );
            },
          }}
          componentsProps={{
            image: ({ photo }) => {
              const photoId = extractPhotoId(photo as Photo & { id?: string });
              const state = loadStates[photoId] ?? 'loading';
              return {
                className: cn(
                  'h-full w-full object-cover transition-opacity duration-200',
                  state === 'loaded' ? 'opacity-100' : 'opacity-0',
                ),
                onLoad: () =>
                  setLoadStates((prev) =>
                    prev[photoId] === 'loaded' ? prev : { ...prev, [photoId]: 'loaded' },
                  ),
                onError: () =>
                  setLoadStates((prev) =>
                    prev[photoId] === 'error' ? prev : { ...prev, [photoId]: 'error' },
                  ),
              };
            },
          }}
          onClick={({ index }) => {
            const photo = items[index];
            if (photo) onOpenPhoto(photo.id);
          }}
        />
      </div>

      {/* Lightbox */}
      <PhotoLightbox
        items={lightboxItems}
        open={currentIndex >= 0}
        initialIndex={currentIndex >= 0 ? currentIndex : 0}
        onClose={onClose}
        onIndexChange={onSwitchPhoto}
        showDownload={true}
        onDownload={(photoId) => {
          void handleDownload(photoId);
        }}
        onShare={(photoId) => {
          void handleShare(photoId);
        }}
      />

      {/* Delete confirmation dialog */}
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
