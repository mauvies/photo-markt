'use client';

import { ArrowLeft } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LightboxToolbar } from '@/components/lightbox-toolbar';

export type PhotoLightboxItem = {
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
};

export function PhotoLightbox({
  items,
  open,
  initialIndex = 0,
  onClose,
  onIndexChange,
  showDownload = false,
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
}: PhotoLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [addedPhotos, setAddedPhotos] = useState<Set<string>>(new Set());
  const [addedToCart, setAddedToCart] = useState<Set<string>>(new Set());
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  // `createPortal` needs `document.body`, which isn't available during SSR.
  // Defer mounting until the first client render to avoid hydration issues.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const currentPhoto = useMemo(() => items[currentIndex], [items, currentIndex]);

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
    () => currentPhoto && (photosInCart.has(currentPhoto.id) || addedToCart.has(currentPhoto.id)),
    [currentPhoto, photosInCart, addedToCart],
  );

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

  // Touch/swipe support
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return;

    const distance = touchEnd !== null ? touchStart - touchEnd : 0;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && items.length > 1) {
      handleNext();
      return;
    }
    if (isRightSwipe && items.length > 1) {
      handlePrevious();
      return;
    }

    // Tap (no significant movement) — toggle controls on touch devices,
    // unless the tap landed on an interactive control.
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

  const handleAddToCart = useCallback(async () => {
    if (!currentPhoto) return;

    if (isInCart) {
      setAddedToCart((prev) => {
        const next = new Set(prev);
        next.delete(currentPhoto.id);
        return next;
      });
      if (onRemoveFromCart) {
        try {
          await onRemoveFromCart(currentPhoto.id);
        } catch {
          setAddedToCart((prev) => new Set(prev).add(currentPhoto.id));
        }
      }
    } else {
      setAddedToCart((prev) => new Set(prev).add(currentPhoto.id));
      if (onAddToCart) {
        try {
          await onAddToCart(currentPhoto.id);
        } catch {
          setAddedToCart((prev) => {
            const next = new Set(prev);
            next.delete(currentPhoto.id);
            return next;
          });
        }
      }
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

  // Render through a portal at `document.body` so the lightbox escapes any
  // stacking context (mobile bottom nav, sticky headers) created by the
  // page's layout. The `z-[100]` keeps it above app chrome that uses `z-50`.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black"
      style={{ height: '100vh', width: '100vw' }}
      onClick={handleBackdropClick}
      onKeyDown={handleBackdropKeyDown}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <LightboxToolbar
        visible={controlsVisible}
        currentPhoto={currentPhoto}
        itemCount={items.length}
        currentIndex={currentIndex}
        isFullscreen={isFullscreen}
        isInMyPhotos={isInMyPhotos}
        isInCart={isInCart}
        showDownload={showDownload}
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
      />

      {/* Image Container */}
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          height: '100vh',
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
            className={`absolute left-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-opacity duration-200 hover:bg-white/15 md:left-8 cursor-pointer ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            aria-label="Previous photo"
          >
            <ArrowLeft className="h-7 w-7" strokeWidth={1.5} />
          </button>
        )}

        {/* Image */}
        <div className="relative w-full h-full" style={{ minHeight: 0 }}>
          <Image
            src={currentPhoto.url}
            alt={currentPhoto.alt || 'Photo'}
            fill
            className="object-contain pointer-events-none"
            priority
            sizes="100vw"
            draggable={false}
            unoptimized={
              currentPhoto.url.includes('/api/') || currentPhoto.url.includes('localhost')
            }
          />
        </div>

        {/* Next button */}
        {items.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className={`absolute right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-opacity duration-200 hover:bg-white/15 md:right-8 cursor-pointer ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            aria-label="Next photo"
          >
            <ArrowLeft className="h-7 w-7 rotate-180" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
