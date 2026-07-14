'use client';

import { ImageOff } from 'lucide-react';
import Image from 'next/image';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { LightboxActionLabels } from '@/components/lightbox-action-bar';
import {
  PhotoDetailModal,
  type PhotoDetailModalItem,
  type PhotoDetailModalLabels,
} from '@/components/photo-detail-modal';
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
import { shouldSkipImageOptimization } from '@/lib/image-source';
import { cn } from '@/lib/utils';

/** Matches the `sm`/`md`/`lg` breakpoints in `grid-cols-*` below so `next/image`
 * requests a close-fitting resize instead of always the largest variant. */
const GRID_SIZES =
  '(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw';

/** Eagerly load the first row so the above-the-fold LCP tile isn't lazy — the
 * widest breakpoint (`lg:grid-cols-5`) shows 5 per row, so priming the first 5
 * covers the LCP candidate on every breakpoint. Load-more pages append after
 * these, so they stay lazy. */
const PRIORITY_TILE_COUNT = 5;

export type PhotoAlbumItem = {
  id: string;
  /** Fallback URL — watermark route or signed original. Always present. */
  url: string;
  /** /api/thumb/.../small.webp — only set when thumbnail_status='ready'. */
  thumbSmall?: string;
  /** /api/thumb/.../medium.webp — only set when thumbnail_status='ready'. */
  thumbMedium?: string;
  /** Force `next/image` to skip the optimizer for this tile's effective src —
   * used when the source is a large signed original (owner view of a
   * watermarked event) that would otherwise time out the optimizer (T-110).
   * Defaults to the URL-based `shouldSkipImageOptimization` heuristic. */
  unoptimized?: boolean;
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
  /** Human-readable location (city / state / country), for the detail modal. */
  location?: string;
  /** ISO capture date (`taken_at`), for the detail modal. */
  takenAt?: string;
};

type PhotoAlbumViewerProps = {
  /** A flat gallery. Provide this OR `itemBatches`. */
  items?: PhotoAlbumItem[];
  /** Paginated load-more pages. The grid uses fixed CSS columns rather than
   * aspect-ratio-justified rows, so appending a page never re-flows the tiles
   * already on screen (no scroll-jump) — pages are simply concatenated into
   * one continuous grid. The flat item list (for the lightbox, dimensions,
   * and selection) is derived from these — a single source of truth, so it
   * can never drift out of sync with what's rendered. */
  itemBatches?: PhotoAlbumItem[][];
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
  /** Per-photo predicate gating the lightbox Download action — when it returns
   *  false the Download button is hidden for that photo. Defaults to allowed. */
  isPhotoDownloadable?: (photoId: string) => boolean;
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
  /** When true, the uploader's name is shown as always-visible text at the
   * bottom-left of each tile instead of the camera-icon popover. */
  showUploaderName?: boolean;
  /** When true, the per-photo overlay is hidden on coarse-pointer (touch)
   * devices — the clean mobile gallery. Desktop hover is unaffected. */
  cleanOnCoarsePointer?: boolean;
  /** Lightbox: 'bottom' moves the per-photo actions into a bottom action bar. */
  lightboxActionBar?: 'top' | 'bottom';
  onClaimToProfile?: (photoId: string) => void;
  claimedIds?: Set<string>;
  canClaimToProfile?: (photoId: string) => boolean;
  actionBarLabels?: LightboxActionLabels;
  /** Detail view opened on tap. `'purchase'` opens the two-panel
   * `PhotoDetailModal` (paid purchase surfaces); the default `'lightbox'`
   * keeps the icon-toolbar lightbox. */
  detailVariant?: 'lightbox' | 'purchase';
  /** Flat event price in dollars, shown in the purchase modal's price row. */
  pricePerPhoto?: number | null;
  /** Locale (page `lang`) for the purchase modal's date formatting. */
  locale?: string;
  /** Event photographer's display name — the purchase modal's attribution
   * fallback for photos with no per-upload contributor. */
  photographerName?: string;
  /** Labels for the purchase modal — required when `detailVariant='purchase'`. */
  purchaseLabels?: PhotoDetailModalLabels;
};

export default function PhotoAlbumViewer({
  items: itemsProp,
  itemBatches,
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
  isPhotoDownloadable,
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
  showUploaderName = false,
  cleanOnCoarsePointer = false,
  lightboxActionBar = 'top',
  onClaimToProfile,
  claimedIds,
  canClaimToProfile,
  actionBarLabels,
  detailVariant = 'lightbox',
  pricePerPhoto,
  locale,
  photographerName,
  purchaseLabels,
}: PhotoAlbumViewerProps) {
  // Single source of truth: when the caller paginates via `itemBatches`, the
  // flat list is their concatenation; otherwise it's the flat `items` prop.
  // Everything below (lightbox, dimensions, selection) works off this — and the
  // rendered segments are slices of it, so they can't drift out of sync.
  const items = useMemo(() => itemBatches?.flat() ?? itemsProp ?? [], [itemBatches, itemsProp]);
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

  // Uniform tile source: fixed-size crops (aspect-square, object-cover) don't
  // need natural width/height, so this — unlike the old justified-rows layout
  // — never varies tile count per row by aspect ratio. `next/image` resizes
  // the medium thumbnail (or the full url as fallback) down to the rendered
  // tile size per `GRID_SIZES`, so no manual srcSet is needed.
  const photos = useMemo(
    () =>
      items.map((p) => ({
        id: p.id,
        src: p.thumbMedium ?? p.url,
        alt: p.alt ?? 'photo',
        unoptimized: p.unoptimized,
      })),
    [items],
  );

  const lightboxItems: PhotoLightboxItem[] = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        url: item.url,
        thumbMedium: item.thumbMedium,
        unoptimized: item.unoptimized,
        alt: item.alt,
        width: dimensions[item.id]?.width ?? item.width,
        height: dimensions[item.id]?.height ?? item.height,
        tags: item.tags,
        uploader: item.uploader,
      })),
    [items, dimensions],
  );

  const detailItems: PhotoDetailModalItem[] = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        url: item.url,
        thumbMedium: item.thumbMedium,
        unoptimized: item.unoptimized,
        alt: item.alt,
        width: dimensions[item.id]?.width ?? item.width,
        height: dimensions[item.id]?.height ?? item.height,
        uploader: item.uploader,
        location: item.location,
        takenAt: item.takenAt,
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
    (photoId: string, isPriorityTile = false) => {
      const state = loadStates[photoId] ?? 'loading';

      // While the image is in flight, cover the tile with a skeleton and
      // hide every action icon / badge so they don't float over an empty
      // placeholder. On error, swap the skeleton for a muted fallback.
      // Priority (above-the-fold) tiles already render their skeleton behind
      // the image so it can paint before hydration — don't cover them here.
      if (state === 'loading') {
        return isPriorityTile ? null : <Skeleton className="absolute inset-0 rounded-lg" />;
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
          showUploaderName={showUploaderName}
          tooltips={iconTooltips}
        />
      );
    },
    [
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
      showUploaderName,
      openMenuPhotoId,
      cleanGrid,
    ],
  );

  const handleTileActivate = useCallback(
    (photoId: string) => {
      if (canSelect && selectionActive) {
        handleToggleSelect(photoId);
        return;
      }
      openAt(photoId);
    },
    [canSelect, selectionActive, handleToggleSelect, openAt],
  );

  return (
    <>
      {/* Fixed columns per breakpoint — every row holds the same tile count
          regardless of each photo's aspect ratio (unlike the previous
          justified-rows layout, which packed 4 vs 3 per row depending on it). */}
      <div className="grid w-full max-w-full min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {photos.map((photo, index) => {
          const photoId = photo.id;
          const isSelected = selectedSet.has(photoId);
          const state = loadStates[photoId] ?? 'loading';
          return (
            // biome-ignore lint/a11y/useSemanticElements: Intentionally using div to avoid nested buttons
            <div
              key={photoId}
              tabIndex={0}
              role="button"
              data-selected={isSelected ? '' : undefined}
              className={cn(
                'group relative aspect-square overflow-hidden rounded-lg bg-muted p-0 text-left focus:outline-none focus:ring-2 focus:ring-ring/30 selection:ring-0',
                canSelect ? 'cursor-pointer' : 'cursor-zoom-in',
              )}
              onClick={() => handleTileActivate(photoId)}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleTileActivate(photoId);
                }
              }}
            >
              {/* Priority tiles get their skeleton BEHIND the image (earlier in
                  DOM) so the LCP image paints progressively over it; the
                  below-the-fold tiles keep the covering skeleton + fade from
                  renderExtras. (T-123) */}
              {index < PRIORITY_TILE_COUNT && state === 'loading' && (
                <Skeleton className="absolute inset-0 rounded-lg" />
              )}
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                priority={index < PRIORITY_TILE_COUNT}
                sizes={GRID_SIZES}
                unoptimized={photo.unoptimized ?? shouldSkipImageOptimization(photo.src)}
                className={cn(
                  'object-cover',
                  // LCP candidates must not wait for hydration + onLoad to paint.
                  index < PRIORITY_TILE_COUNT
                    ? state === 'error' && 'opacity-0'
                    : cn(
                        'transition-opacity duration-200',
                        state === 'loaded' ? 'opacity-100' : 'opacity-0',
                      ),
                  state === 'loaded' && canSelect && isSelected && 'opacity-75',
                )}
                onLoad={() =>
                  setLoadStates((prev) =>
                    prev[photoId] === 'loaded' ? prev : { ...prev, [photoId]: 'loaded' },
                  )
                }
                onError={() =>
                  setLoadStates((prev) =>
                    prev[photoId] === 'error' ? prev : { ...prev, [photoId]: 'error' },
                  )
                }
              />
              {renderExtras(photoId, index < PRIORITY_TILE_COUNT)}
            </div>
          );
        })}
      </div>
      {detailVariant === 'purchase' && purchaseLabels && locale ? (
        <PhotoDetailModal
          items={detailItems}
          open={index >= 0}
          initialIndex={index >= 0 ? index : 0}
          onClose={close}
          onIndexChange={switchTo}
          labels={purchaseLabels}
          locale={locale}
          photographerName={photographerName}
          pricePerPhoto={pricePerPhoto}
          showAddToCart={showAddToCart}
          showDownload={showDownload}
          canDownloadPhoto={isPhotoDownloadable}
          photosInCart={photosInCart}
          onAddToCart={onAddToCart}
          onRemoveFromCart={onRemoveFromCart}
          onDownload={onDownload}
          onShare={onShare}
          showAddToFavorites={showAddToPhotos}
          photosInMyPhotos={photosInMyPhotos}
          onAddToPhotos={onAddToPhotos}
          onRemoveFromPhotos={onRemoveFromPhotos}
        />
      ) : (
        <PhotoLightbox
          items={lightboxItems}
          open={index >= 0}
          initialIndex={index >= 0 ? index : 0}
          onClose={close}
          onIndexChange={switchTo}
          showDownload={showDownload}
          canDownloadPhoto={isPhotoDownloadable}
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
      )}
    </>
  );
}
