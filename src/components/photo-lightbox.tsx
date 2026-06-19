'use client';

import { ArrowLeft, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LightboxActionLabels } from '@/components/lightbox-action-bar';
import { LightboxToolbar } from '@/components/lightbox-toolbar';
import { getLightboxWindow, slideOffset } from '@/components/photo-lightbox-window';
import type { PhotoUploaderInfo } from '@/components/photo-uploader-indicator';

// Radius of the preload window around the current photo — the current image
// plus this many neighbours on each side are kept mounted so next/prev
// navigation reveals an already-decoded image.
const PRELOAD_RADIUS = 2;

export type PhotoLightboxItem = {
  id: string;
  /** Full-resolution fallback (watermark route or signed original). */
  url: string;
  /** /api/thumb/.../medium.webp — shown as the visible lightbox image when
   * available. The original (url) is only fetched on explicit Download. */
  thumbMedium?: string;
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
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [addedPhotos, setAddedPhotos] = useState<Set<string>>(new Set());
  // Photo ids whose <Image> has finished loading — drives the loading spinner.
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  // Cart state is now owned by the parent via `useOptimisticPhotosInCart`,
  // which flips `photosInCart` optimistically. We just read from it.
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  // `createPortal` needs `document.body`, which isn't available during SSR.
  // Defer mounting until the first client render to avoid hydration issues.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const currentPhoto = useMemo(() => items[currentIndex], [items, currentIndex]);
  // The current photo plus its ±PRELOAD_RADIUS neighbours — all kept mounted
  // and eagerly loaded so navigating within the window is instant.
  const windowIndices = useMemo(
    () => getLightboxWindow(currentIndex, items.length, PRELOAD_RADIUS),
    [currentIndex, items.length],
  );

  const markLoaded = useCallback((id: string) => {
    setLoadedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  // NOTE: We intentionally do NOT mirror `currentIndex` → URL via a
  // useEffect. An effect with `items` in its deps would fire on every
  // re-render where the parent rebuilds the array, emitting `onIndexChange`
  // and causing the lightbox to auto-advance through photos. Instead, the
  // emit happens in handlePrevious/handleNext below — i.e. only when the
  // user actually navigates. Initial open already has the correct URL
  // because the consumer called `openAt` before rendering the lightbox.

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsTouchDevice(window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  }, []);

  const isInMyPhotos = useMemo(
    () =>
      currentPhoto && (photosInMyPhotos.has(currentPhoto.id) || addedPhotos.has(currentPhoto.id)),
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

  // Reset index when opening and prevent body scroll
  useEffect(() => {
    if (open) {
      setCurrentIndex(initialIndex);
      setControlsVisible(true);
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    } else {
      // Restore body scroll
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [open, initialIndex]);

  // Navigation handlers — explicitly emit `onIndexChange` for the NEW
  // index so the consumer can update the URL. Emitting here (instead of
  // via a useEffect on currentIndex) guarantees the URL only changes in
  // response to user-initiated navigation, never as a side effect of a
  // parent re-render.
  const handlePrevious = useCallback(() => {
    const next = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    setCurrentIndex(next);
    const id = items[next]?.id;
    if (id) onIndexChange?.(id);
  }, [currentIndex, items, onIndexChange]);

  const handleNext = useCallback(() => {
    const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    setCurrentIndex(next);
    const id = items[next]?.id;
    if (id) onIndexChange?.(id);
  }, [currentIndex, items, onIndexChange]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrevious();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, handlePrevious, handleNext]);

  // Touch/swipe support. The drag is driven imperatively on `trackRef` (the
  // slide track) so the finger moves the photo live at 60fps with zero React
  // re-renders mid-gesture; React only kicks in on release to snap.
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number | null>(null);
  const dragDeltaX = useRef(0);

  // Past this many px a horizontal drag commits to next/prev; below TAP_PX a
  // release is treated as a tap (toggle controls), not a swipe.
  const SWIPE_COMMIT_PX = 50;
  const TAP_PX = 10;

  const onTouchStart = (e: React.TouchEvent) => {
    dragStartX.current = e.touches[0].clientX;
    dragDeltaX.current = 0;
    // Disable the snap transition so the track follows the finger 1:1.
    if (trackRef.current) trackRef.current.style.transition = 'none';
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStartX.current === null) return;
    dragDeltaX.current = e.touches[0].clientX - dragStartX.current;
    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${dragDeltaX.current}px)`;
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (dragStartX.current === null) return;
    const delta = dragDeltaX.current;
    dragStartX.current = null;

    // Restore the snap transition and animate the track back to rest. When we
    // also advance the index, each slide's own transform animates by one slot;
    // both tweens share duration/easing so the motion stays continuous from
    // wherever the finger let go.
    if (trackRef.current) {
      trackRef.current.style.transition = '';
      trackRef.current.style.transform = 'translateX(0px)';
    }

    if (Math.abs(delta) >= SWIPE_COMMIT_PX && items.length > 1) {
      if (delta < 0) handleNext();
      else handlePrevious();
      return;
    }

    // Tap (no significant movement) — toggle controls on touch devices,
    // unless the tap landed on an interactive control.
    if (Math.abs(delta) >= TAP_PX) return; // small drag → just snapped back
    if (!isTouchDevice) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, [role="button"]')) return;
    setControlsVisible((v) => !v);
  };

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

    // Default: share the photo URL
    if (!currentPhoto.url) return;

    if (navigator.share) {
      navigator
        .share({
          title: currentPhoto.alt || 'Photo',
          url: currentPhoto.url,
        })
        .catch(() => {
          // Fallback to copy
          navigator.clipboard.writeText(currentPhoto.url).catch(() => {});
        });
    } else {
      navigator.clipboard.writeText(currentPhoto.url).catch(() => {});
    }
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

  const isCurrentLoaded = loadedIds.has(currentPhoto.id);

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

      {/* Image Container */}
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          height: '100dvh',
          marginTop: 0,
          paddingTop: isFullscreen ? '4.5rem' : '0',
          paddingBottom: isFullscreen ? '0.5rem' : '0',
          paddingLeft: isFullscreen ? '0.5rem' : '0',
          paddingRight: isFullscreen ? '0.5rem' : '0',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Previous button */}
        {items.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePrevious();
            }}
            className={`absolute left-4 z-20 hidden h-14 w-14 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-opacity duration-200 hover:bg-white/15 md:left-8 md:flex cursor-pointer ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            aria-label="Previous photo"
          >
            <ArrowLeft className="h-7 w-7" strokeWidth={1.5} />
          </button>
        )}

        {/* Image stack — the current photo plus its ±PRELOAD_RADIUS window,
            all kept mounted and eagerly fetched. Each slide sits at its slot
            (current at 0, neighbours just off-screen left/right). The track
            wrapping them is dragged live by the finger (see onTouchMove), and
            on release the slides' own transforms animate by one slot while the
            track eases back to 0 — a continuous carousel slide. Off-screen
            slides are clipped by the container's overflow. */}
        <div className="relative w-full h-full" style={{ minHeight: 0 }}>
          <div
            ref={trackRef}
            className="absolute inset-0 transition-transform duration-300 ease-out will-change-transform"
          >
            {windowIndices.map((i) => {
              const item = items[i];
              if (!item) return null;
              const offset = slideOffset(i, currentIndex, items.length);
              return (
                <Image
                  key={item.id}
                  src={item.thumbMedium ?? item.url}
                  alt={item.alt || 'Photo'}
                  fill
                  className="object-contain pointer-events-none transition-transform duration-300 ease-out"
                  style={{ transform: `translateX(${offset * 100}%)` }}
                  loading="eager"
                  sizes="100vw"
                  draggable={false}
                  onLoad={() => markLoaded(item.id)}
                  unoptimized={
                    (item.thumbMedium ?? item.url).includes('/api/') ||
                    (item.thumbMedium ?? item.url).includes('localhost')
                  }
                />
              );
            })}
          </div>
          {/* Spinner for an unavoidable load — first open, or a jump beyond
              the preload window. In-window navigation is already decoded. */}
          {isCurrentLoaded ? null : (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-white/70" aria-hidden />
            </div>
          )}
        </div>

        {/* Next button */}
        {items.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className={`absolute right-4 z-20 hidden h-14 w-14 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-opacity duration-200 hover:bg-white/15 md:right-8 md:flex cursor-pointer ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            aria-label="Next photo"
          >
            <ArrowLeft className="h-7 w-7 rotate-180" strokeWidth={1.5} />
          </button>
        )}
      </div>

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
