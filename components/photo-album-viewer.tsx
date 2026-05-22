'use client';

import { ImageOff } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { type Photo, type RenderPhotoContext, RowsPhotoAlbum } from 'react-photo-album';
import type { LightboxActionLabels } from '@/components/lightbox-action-bar';
import {
  PhotoIconButtons,
  type PhotoIconTooltips,
  type PhotoMoreMenuConfig,
} from '@/components/photo-icon-buttons';
import { PhotoLightbox, type PhotoLightboxItem } from '@/components/photo-lightbox';
import type { PhotoUploaderInfo } from '@/components/photo-uploader-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import { usePhotoLightboxUrl } from '@/hooks/use-photo-lightbox-url';
import { cn } from '@/lib/utils';
import 'react-photo-album/rows.css';

export type PhotoAlbumItem = {
  id: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  tags?: Array<{
    tag_id: string;
    talent_user_id: string;
    talent_username: string;
    talent_display_name: string | null;
    tagged_at: string;
  }>;
  /** Optional contributor info — when present, the camera badge is rendered. */
  uploader?: PhotoUploaderInfo;
};

type PhotoAlbumViewerProps = {
  items: PhotoAlbumItem[];
  selectionMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (photoId: string) => void;
  onTagPhoto?: (photoId: string) => void;
  onUntag?: () => void;
  /** Custom lightbox Share handler — defaults to the native share sheet. */
  onShare?: (photoId: string) => void;
  showAddToCart?: boolean;
  photosInCart?: Set<string>;
  onAddToCart?: (photoId: string) => void;
  onRemoveFromCart?: (photoId: string) => void;
  onDownload?: (photoId: string) => void;
  onAddToPhotos?: (photoId: string) => void;
  onRemoveFromPhotos?: (photoId: string) => void;
  onRemove?: (photoId: string) => void;
  onTagTalent?: (photoId: string) => void;
  // Button visibility controls
  showDownload?: boolean;
  showAddToPhotos?: boolean;
  showRemove?: boolean;
  showTagTalent?: boolean;
  // Track which photos are in "my photos"
  photosInMyPhotos?: Set<string>;
  iconTooltips?: Partial<PhotoIconTooltips>;
  /** Set of photo IDs the current viewer is allowed to delete. */
  deletableIds?: Set<string>;
  onDeleteOwn?: (photoId: string) => void;
  deleteTooltip?: string;
  /** Localized labels for the uploader badge popover (when items have uploader). */
  uploaderLabels?: {
    tooltip: string;
    popoverHeading: string;
    guestLabel: string;
    authenticatedLabel: string;
  };
  /** Fallback text shown in tiles whose image fails to load. */
  imageUnavailableLabel?: string;
  /** When set, each tile shows a 3-dot "more options" menu (collaborative photographer view). */
  moreMenu?: PhotoMoreMenuConfig;
  /** When true, the per-photo overlay is hidden on coarse-pointer (touch)
   * devices — the clean mobile gallery. Desktop hover is unaffected. */
  cleanOnCoarsePointer?: boolean;
  /** Lightbox: 'bottom' moves the per-photo actions into a bottom action bar. */
  lightboxActionBar?: 'top' | 'bottom';
  onClaimToProfile?: (photoId: string) => void;
  claimedIds?: Set<string>;
  canClaimToProfile?: (photoId: string) => boolean;
  actionBarLabels?: LightboxActionLabels;
};

export default function PhotoAlbumViewer({
  items,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  onTagPhoto,
  onUntag,
  onShare,
  showAddToCart = false,
  photosInCart = new Set(),
  onAddToCart,
  onRemoveFromCart,
  onDownload,
  onAddToPhotos,
  onRemoveFromPhotos,
  onRemove,
  onTagTalent,
  showDownload = false,
  showAddToPhotos = false,
  showRemove = false,
  showTagTalent = false,
  photosInMyPhotos = new Set(),
  iconTooltips,
  deletableIds,
  onDeleteOwn,
  deleteTooltip,
  uploaderLabels,
  imageUnavailableLabel = 'Image unavailable',
  moreMenu,
  cleanOnCoarsePointer = false,
  lightboxActionBar = 'top',
  onClaimToProfile,
  claimedIds,
  canClaimToProfile,
  actionBarLabels,
}: PhotoAlbumViewerProps) {
  const { index, openAt, switchTo, close } = usePhotoLightboxUrl(items);
  const [dimensions, setDimensions] = useState<Record<string, { width: number; height: number }>>(
    {},
  );
  // Track per-tile image load state so we can show a skeleton until the
  // photo lands, and keep action icons / overlays hidden in the meantime.
  const [loadStates, setLoadStates] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({});
  const [openPopovers, setOpenPopovers] = useState<Set<string>>(new Set());
  // Only one photo's 3-dot menu may be open at a time — opening another (or
  // an outside click) closes the previous one.
  const [openMenuPhotoId, setOpenMenuPhotoId] = useState<string | null>(null);
  const selectedSet = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);
  const canSelect = Boolean(onToggleSelect);
  const selectionActive = selectionMode || selectedSet.size > 0;

  // Clean mobile gallery — the per-photo overlay is hidden on touch devices
  // (except the selection checkmark while selecting).
  const coarsePointer = useCoarsePointer();
  const cleanGrid = cleanOnCoarsePointer && coarsePointer;

  const extractPhotoId = useCallback((photo: Photo & { id?: string }) => {
    if (typeof photo.id === 'string' && photo.id.length > 0) return photo.id;
    if (typeof photo.key === 'string' && photo.key.length > 0) return photo.key;
    return photo.src;
  }, []);

  useEffect(() => {
    items.forEach((item) => {
      if (dimensions[item.id]) return;
      if (!item.url) {
        console.warn(`Photo ${item.id} has no URL`);
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        const width = img.naturalWidth || item.width || 1600;
        const height = img.naturalHeight || item.height || 1066;
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
              width: item.width ?? 1600,
              height: item.height ?? 1066,
            },
          };
        });
      };
      img.src = item.url;
    });
  }, [items, dimensions]);

  const photos: Array<Photo & { id: string }> = useMemo(
    () =>
      items.map((p) => {
        const dims = dimensions[p.id];
        return {
          id: p.id,
          key: p.id,
          src: p.url,
          alt: p.alt ?? 'photo',
          width: dims?.width ?? p.width ?? 1600,
          height: dims?.height ?? p.height ?? 1066,
        };
      }),
    [items, dimensions],
  );

  const lightboxItems: PhotoLightboxItem[] = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        url: item.url,
        alt: item.alt,
        width: dimensions[item.id]?.width ?? item.width,
        height: dimensions[item.id]?.height ?? item.height,
        tags: item.tags,
        uploader: item.uploader,
      })),
    [items, dimensions],
  );

  const handleToggleSelect = useCallback(
    (photoId: string) => {
      if (!canSelect || !onToggleSelect) return;
      onToggleSelect(photoId);
    },
    [canSelect, onToggleSelect],
  );

  const renderExtras = useCallback(
    (_props: object, { photo }: RenderPhotoContext<Photo & { id?: string }>) => {
      const photoId = extractPhotoId(photo);
      const state = loadStates[photoId] ?? 'loading';

      // While the image is in flight, cover the tile with a skeleton and
      // hide every action icon / badge so they don't float over an empty
      // placeholder. On error, swap the skeleton for a muted fallback.
      if (state === 'loading') {
        return <Skeleton className="absolute inset-0 rounded-lg" />;
      }
      if (state === 'error') {
        return (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
            <ImageOff className="h-8 w-8 opacity-40" aria-hidden />
            <span className="text-xs">{imageUnavailableLabel}</span>
          </div>
        );
      }

      // Clean mobile gallery: no overlay unless the user is selecting.
      if (cleanGrid && !selectionActive) {
        return null;
      }

      const isSelected = selectedSet.has(photoId);
      const photoItem = items.find((item) => item.id === photoId);
      const tags = photoItem?.tags || [];
      const uploader = photoItem?.uploader;
      const isPopoverOpen = openPopovers.has(photoId);

      const canDelete = deletableIds?.has(photoId) ?? false;

      return (
        <PhotoIconButtons
          photoId={photoId}
          isSelected={isSelected}
          hasTags={tags.length > 0}
          tags={tags}
          uploader={uploader}
          uploaderLabels={uploaderLabels}
          canDelete={canDelete}
          onDelete={onDeleteOwn}
          deleteTooltip={deleteTooltip}
          isPopoverOpen={isPopoverOpen}
          onPopoverOpenChange={(open) => {
            if (open) {
              setOpenPopovers((prev) => {
                const next = new Set(prev);
                next.add(photoId);
                return next;
              });
            } else {
              setOpenPopovers((prev) => {
                const next = new Set(prev);
                next.delete(photoId);
                return next;
              });
            }
          }}
          canSelect={canSelect}
          onToggleSelect={handleToggleSelect}
          selectionActive={selectionActive}
          onTagPhoto={onTagPhoto}
          onUntag={onUntag}
          showAddToCart={showAddToCart}
          photosInCart={photosInCart}
          onAddToCart={onAddToCart}
          onRemoveFromCart={onRemoveFromCart}
          showAddToPhotos={showAddToPhotos}
          photosInMyPhotos={photosInMyPhotos}
          onAddToPhotos={onAddToPhotos}
          onRemoveFromPhotos={onRemoveFromPhotos}
          moreMenu={moreMenu}
          moreMenuOpen={openMenuPhotoId === photoId}
          onMoreMenuOpenChange={(open) => setOpenMenuPhotoId(open ? photoId : null)}
          tooltips={iconTooltips}
        />
      );
    },
    [
      extractPhotoId,
      loadStates,
      imageUnavailableLabel,
      canSelect,
      handleToggleSelect,
      selectedSet,
      items,
      onUntag,
      onTagPhoto,
      openPopovers,
      photosInCart,
      showAddToCart,
      onAddToCart,
      onRemoveFromCart,
      showAddToPhotos,
      photosInMyPhotos,
      onAddToPhotos,
      onRemoveFromPhotos,
      selectionActive,
      iconTooltips,
      deletableIds,
      onDeleteOwn,
      deleteTooltip,
      uploaderLabels,
      moreMenu,
      openMenuPhotoId,
      cleanGrid,
    ],
  );

  return (
    <>
      <div className="w-full max-w-full min-w-0">
        <RowsPhotoAlbum
          photos={photos}
          targetRowHeight={250}
          rowConstraints={{ singleRowMaxHeight: 250 }}
          spacing={10}
          render={{
            extras: renderExtras,
            button: (props, { photo }) => {
              const photoId = extractPhotoId(photo as Photo & { id?: string });
              const isSelected = selectedSet.has(photoId);
              const { onClick, className: propsClassName, ...restProps } = props;
              return (
                // biome-ignore lint/a11y/useSemanticElements: Intentionally using div to avoid nested buttons
                <div
                  {...(restProps as React.HTMLAttributes<HTMLDivElement>)}
                  onClick={
                    onClick
                      ? (e: React.MouseEvent<HTMLDivElement>) => {
                          onClick(e as unknown as React.MouseEvent<HTMLButtonElement>);
                        }
                      : undefined
                  }
                  tabIndex={0}
                  role="button"
                  data-selected={isSelected ? '' : undefined}
                  className={cn(
                    'group relative flex h-full w-full overflow-hidden rounded-lg bg-muted p-0 text-left focus:outline-none focus:ring-2 focus:ring-ring/30 selection:ring-0',
                    canSelect ? 'cursor-pointer' : 'cursor-zoom-in',
                    propsClassName,
                  )}
                  onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onClick?.(event as unknown as React.MouseEvent<HTMLButtonElement>);
                    }
                  }}
                />
              );
            },
            link: (props, { photo }) => {
              const photoId = extractPhotoId(photo as Photo & { id?: string });
              const isSelected = selectedSet.has(photoId);
              const { onClick, href, className: propsClassName, ...restProps } = props;
              return (
                // biome-ignore lint/a11y/useSemanticElements: Intentionally using div to avoid nested buttons
                <div
                  {...(restProps as React.HTMLAttributes<HTMLDivElement>)}
                  onClick={
                    onClick
                      ? (e: React.MouseEvent<HTMLDivElement>) => {
                          e.preventDefault();
                          onClick(e as unknown as React.MouseEvent<HTMLAnchorElement>);
                        }
                      : undefined
                  }
                  tabIndex={0}
                  role="link"
                  data-selected={isSelected ? '' : undefined}
                  aria-label={href}
                  className={cn(
                    'group relative flex h-full w-full overflow-hidden rounded-lg bg-muted p-0 text-left focus:outline-none focus:ring-2 focus:ring-ring/30 selection:ring-0',
                    canSelect ? 'cursor-pointer' : 'cursor-zoom-in',
                    propsClassName,
                  )}
                  onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onClick?.(event as unknown as React.MouseEvent<HTMLAnchorElement>);
                    }
                  }}
                />
              );
            },
          }}
          componentsProps={{
            image: ({ photo }) => {
              const photoId = extractPhotoId(photo as Photo & { id?: string });
              const isSelected = selectedSet.has(photoId);
              const state = loadStates[photoId] ?? 'loading';
              return {
                className: cn(
                  'h-full w-full object-cover transition-opacity duration-200',
                  state === 'loaded' ? 'opacity-100' : 'opacity-0',
                  state === 'loaded' && canSelect && isSelected && 'opacity-75',
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
          onClick={({ photo }) => {
            const photoId = extractPhotoId(photo as Photo & { id?: string });
            if (canSelect && selectionActive) {
              handleToggleSelect(photoId);
              return;
            }
            openAt(photoId);
          }}
        />
      </div>
      <PhotoLightbox
        items={lightboxItems}
        open={index >= 0}
        initialIndex={index >= 0 ? index : 0}
        onClose={close}
        onIndexChange={switchTo}
        showDownload={showDownload}
        showAddToPhotos={showAddToPhotos}
        showAddToCart={showAddToCart}
        showRemove={showRemove}
        showTagTalent={showTagTalent}
        onDownload={onDownload}
        onAddToPhotos={onAddToPhotos}
        onRemoveFromPhotos={onRemoveFromPhotos}
        onAddToCart={onAddToCart}
        onRemoveFromCart={onRemoveFromCart}
        onRemove={onRemove}
        onTagTalent={onTagTalent}
        onUntag={onUntag}
        onShare={onShare}
        photosInMyPhotos={photosInMyPhotos}
        photosInCart={photosInCart}
        actionBar={lightboxActionBar}
        onClaimToProfile={onClaimToProfile}
        claimedIds={claimedIds}
        canClaimToProfile={canClaimToProfile}
        actionBarLabels={actionBarLabels}
      />
    </>
  );
}
