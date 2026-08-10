'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LightboxActionLabels } from '@/components/lightbox-action-bar';
import { LightboxToolbar } from '@/components/lightbox-toolbar';
import { PhotoCarousel } from '@/components/photo-carousel';
import type { PhotoUploaderInfo } from '@/components/photo-uploader-indicator';
import { useCarouselNavigation } from '@/hooks/use-carousel-navigation';
import { useImageLoad } from '@/hooks/use-image-load';
import { useKeyboardNav } from '@/hooks/use-keyboard-nav';
import { buildPhotoShareUrl } from '@/lib/photo-share-url';
import { shareUrl } from '@/lib/share-url';

export type PhotoLightboxItem = {
  id: string;
  /** Full-resolution fallback (watermark route or signed original). */
  url: string;
  /** /api/thumb/.../medium.webp — shown as the visible lightbox image when
   * available. The original (url) is only fetched on explicit Download. */
  thumbMedium?: string;
  /** Force `next/image` to skip the optimizer (large signed original — T-110).
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
  /** Contributor info — drives the "Uploaded by" caption on the bottom bar. */
  uploader?: PhotoUploaderInfo;
};

type PhotoLightboxProps = {
  items: PhotoLightboxItem[];
  open: boolean;
  initialIndex?: number;
  onClose: () => void;
  // Fires with the new photo id whenever the user navigates between photos
  // inside the lightbox (next/prev/swipe). Consumers use this to mirror the
  // current photo into a URL query param.
  onIndexChange?: (photoId: string) => void;
  // Button visibility
  showDownload?: boolean;
  /**
   * Per-photo override for Download. When provided and it returns false for
   * the current photo, the Download action is hidden even if `showDownload`
   * is true — an unavailable download is never shown. Defaults to allowed.
   */
  canDownloadPhoto?: (photoId: string) => boolean;
  showAddToPhotos?: boolean;
  showAddToCart?: boolean;
  showRemove?: boolean;
  showTagTalent?: boolean;
  // Callbacks
  onDownload?: (photoId: string) => void;
  onShare?: (photoId: string) => void;
  onAddToPhotos?: (photoId: string) => void;
  onRemoveFromPhotos?: (photoId: string) => void;
  onAddToCart?: (photoId: string) => void;
  onRemoveFromCart?: (photoId: string) => void;
  onRemove?: (photoId: string) => void;
  onTagTalent?: (photoId: string) => void;
  onUntag?: () => void;
  // Track which photos are in "my photos" and cart
  photosInMyPhotos?: Set<string>;
  photosInCart?: Set<string>;
  /** Accepted for API compatibility; the lightbox always renders the actions
   * in the top toolbar. */
  actionBar?: 'top' | 'bottom';
  /** "Add to my profile" claim — free photos only. */
  onClaimToProfile?: (photoId: string) => void;
  claimedIds?: Set<string>;
  canClaimToProfile?: (photoId: string) => boolean;
  /** Localized copy for the claim tooltip + the "Uploaded by" caption. */
  actionBarLabels?: LightboxActionLabels;
};

export function PhotoLightbox({
  items,
  open,
  initialIndex = 0,
  onClose,
  onIndexChange,
  showDownload = false,
  canDownloadPhoto,
  showAddToPhotos = false,
  showAddToCart = false,
  showRemove = false,
  showTagTalent = false,
  onDownload,
  onShare,
  onAddToPhotos,
  onRemoveFromPhotos,
  onAddToCart,
  onRemoveFromCart,
  onRemove,
  onTagTalent,
  onUntag,
  photosInMyPhotos = new Set(),
  photosInCart = new Set(),
  onClaimToProfile,
  claimedIds,
  canClaimToProfile,
  actionBarLabels,
}: PhotoLightboxProps) {
  const nav = useCarouselNavigation({ items, open, initialIndex, onIndexChange });
  const { isLoaded, markLoaded } = useImageLoad();
  const currentPhoto = nav.currentItem;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [addedPhotos, setAddedPhotos] = useState<Set<string>>(new Set());
  const [controlsVisible, setControlsVisible] = useState(true);
  // `createPortal` needs `document.body`, which isn't available during SSR.
  // Defer mounting until the first client render to avoid hydration issues.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isInMyPhotos = useMemo(
    () =>
      Boolean(
        currentPhoto && (photosInMyPhotos.has(currentPhoto.id) || addedPhotos.has(currentPhoto.id)),
      ),
    [currentPhoto, photosInMyPhotos, addedPhotos],
  );

  const isInCart = useMemo(
    () => Boolean(currentPhoto && photosInCart.has(currentPhoto.id)),
    [currentPhoto, photosInCart],
  );

  const isClaimed = useMemo(
    () => Boolean(currentPhoto && claimedIds?.has(currentPhoto.id)),
    [currentPhoto, claimedIds],
  );
  const canClaim = Boolean(currentPhoto && canClaimToProfile?.(currentPhoto.id));

  // Download visibility, per-photo: hidden when `canDownloadPhoto` rejects the
  // current photo (e.g. a paid photo the viewer hasn't bought) — never shown
  // greyed-out.
  const downloadAllowed = useMemo(
    () =>
      showDownload && Boolean(currentPhoto) && (canDownloadPhoto?.(currentPhoto?.id ?? '') ?? true),
    [showDownload, currentPhoto, canDownloadPhoto],
  );

  const handleClaim = useCallback(() => {
    if (!currentPhoto || !onClaimToProfile) return;
    onClaimToProfile(currentPhoto.id);
  }, [currentPhoto, onClaimToProfile]);

  const handleTagTalent = useCallback(() => {
    if (!currentPhoto || !onTagTalent) return;
    onTagTalent(currentPhoto.id);
  }, [currentPhoto, onTagTalent]);

  // Reset transient chrome + prevent body scroll while open. Index reset is
  // owned by useCarouselNavigation.
  useEffect(() => {
    if (open) {
      setControlsVisible(true);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useKeyboardNav({ enabled: open, onPrevious: nav.previous, onNext: nav.next, onClose });

  // Fullscreen handling
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!currentPhoto || !onDownload) return;
    onDownload(currentPhoto.id);
  }, [currentPhoto, onDownload]);

  const handleAddToPhotos = useCallback(async () => {
    if (!currentPhoto) return;

    if (isInMyPhotos) {
      setAddedPhotos((prev) => {
        const next = new Set(prev);
        next.delete(currentPhoto.id);
        return next;
      });
      if (onRemoveFromPhotos) {
        try {
          await onRemoveFromPhotos(currentPhoto.id);
        } catch {
          setAddedPhotos((prev) => new Set(prev).add(currentPhoto.id));
        }
      }
    } else {
      setAddedPhotos((prev) => new Set(prev).add(currentPhoto.id));
      if (onAddToPhotos) {
        try {
          await onAddToPhotos(currentPhoto.id);
        } catch {
          setAddedPhotos((prev) => {
            const next = new Set(prev);
            next.delete(currentPhoto.id);
            return next;
          });
        }
      }
    }
  }, [currentPhoto, onAddToPhotos, onRemoveFromPhotos, isInMyPhotos]);

  const handleAddToCart = useCallback(() => {
    // The parent's `useOptimisticPhotosInCart` (or `useGuestCart` for guests)
    // owns the optimistic flip + rollback + toast. We just dispatch.
    if (!currentPhoto) return;
    if (isInCart) {
      onRemoveFromCart?.(currentPhoto.id);
    } else {
      onAddToCart?.(currentPhoto.id);
    }
  }, [currentPhoto, onAddToCart, onRemoveFromCart, isInCart]);

  const handleRemove = useCallback(() => {
    if (!currentPhoto || !onRemove) return;
    onRemove(currentPhoto.id);
  }, [currentPhoto, onRemove]);

  const handleShare = useCallback(() => {
    if (!currentPhoto) return;

    // If custom share handler is provided, use it
    if (onShare) {
      onShare(currentPhoto.id);
      return;
    }

    // Default: share the PAGE this photo is open on, with `?photo=` set — not
    // `currentPhoto.url`, which is the image itself (watermark route or a
    // short-lived signed original). See `buildPhotoShareUrl`.
    const href = buildPhotoShareUrl(currentPhoto.id);
    if (!href) return;
    shareUrl(currentPhoto.alt || 'Photo', href);
  }, [currentPhoto, onShare]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const handleBackdropKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  if (!open || !currentPhoto || !mounted) return null;

  // Render through a portal at `document.body` so the lightbox escapes any
  // stacking context (mobile bottom nav, sticky headers) created by the
  // page's layout. The `z-[100]` keeps it above app chrome that uses `z-50`.
  return createPortal(
    <div
      className="fixed top-0 left-0 right-0 z-[100] flex flex-col bg-black"
      // `left-0 right-0` spans the viewport exactly; an explicit `100vw` would
      // include the (scroll-locked, hidden) scrollbar width and overflow a few
      // px on the right. Height stays dvh for mobile browser chrome.
      style={{ height: '100dvh' }}
      onClick={handleBackdropClick}
      onKeyDown={handleBackdropKeyDown}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <LightboxToolbar
        visible={controlsVisible}
        currentPhoto={currentPhoto}
        isFullscreen={isFullscreen}
        isInMyPhotos={isInMyPhotos}
        isInCart={isInCart}
        showDownload={downloadAllowed}
        showAddToPhotos={showAddToPhotos}
        showAddToCart={showAddToCart}
        showRemove={showRemove}
        showTagTalent={showTagTalent}
        onClose={onClose}
        onShare={handleShare}
        onDownload={handleDownload}
        onAddToPhotos={handleAddToPhotos}
        onAddToCart={handleAddToCart}
        onRemove={handleRemove}
        onTagTalent={handleTagTalent}
        onUntag={onUntag}
        onFullscreen={handleFullscreen}
        showClaim={canClaim}
        isClaimed={isClaimed}
        onClaim={handleClaim}
        actionLabels={actionBarLabels}
      />

      <PhotoCarousel
        items={items}
        currentIndex={nav.currentIndex}
        windowIndices={nav.windowIndices}
        onPrevious={nav.previous}
        onNext={nav.next}
        isLoaded={isLoaded}
        markLoaded={markLoaded}
        controlsVisible={controlsVisible}
        onTap={() => setControlsVisible((v) => !v)}
        style={{
          height: '100dvh',
          marginTop: 0,
          paddingTop: isFullscreen ? '4.5rem' : '0',
          paddingBottom: isFullscreen ? '0.5rem' : '0',
          paddingLeft: isFullscreen ? '0.5rem' : '0',
          paddingRight: isFullscreen ? '0.5rem' : '0',
        }}
      />

      {/* "Uploaded by" caption — info only (no tap targets), so the mobile
          browser's bottom chrome can't occlude anything actionable. */}
      {currentPhoto.uploader?.name && actionBarLabels?.uploadedBy ? (
        <div
          className={`pointer-events-none absolute bottom-0 left-0 right-0 z-20 px-4 pt-8 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] transition-opacity duration-200 ${
            controlsVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/50 via-black/20 to-transparent" />
          <p className="relative truncate text-xs text-white/80">
            {actionBarLabels.uploadedBy.replace('{name}', currentPhoto.uploader.name)}
          </p>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
