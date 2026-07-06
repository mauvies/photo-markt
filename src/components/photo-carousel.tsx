'use client';

import { ArrowLeft, Loader2 } from 'lucide-react';
import Image from 'next/image';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { slideOffset } from '@/components/photo-lightbox-window';
import { cn } from '@/lib/utils';

export interface PhotoCarouselItem {
  id: string;
  /** Full-resolution fallback (watermark route or signed original). */
  url: string;
  /** /api/thumb/.../medium.webp — shown as the visible image when available. */
  thumbMedium?: string;
  alt?: string;
}

// Past this many px a horizontal drag commits to next/prev; below TAP_PX a
// release is treated as a tap, not a swipe.
const SWIPE_COMMIT_PX = 50;
const TAP_PX = 10;

interface PhotoCarouselProps {
  items: PhotoCarouselItem[];
  currentIndex: number;
  /** Indices to keep mounted around the current one (from useCarouselNavigation). */
  windowIndices: number[];
  onPrevious: () => void;
  onNext: () => void;
  isLoaded: (id: string) => boolean;
  markLoaded: (id: string) => void;
  /** Arrow opacity toggle (lightbox hides controls on tap). Defaults visible. */
  controlsVisible?: boolean;
  /** Called on a non-drag tap on a touch device over a non-interactive area. */
  onTap?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The image/carousel guts shared by `PhotoLightbox` (full-screen overlay) and
 * `PhotoDetailModal` (two-panel dialog): the windowed image track with a live
 * finger-driven swipe, desktop prev/next arrows, and a load spinner. Index
 * state, keyboard, and image-load tracking are owned by the parent via the
 * `useCarouselNavigation` / `useKeyboardNav` / `useImageLoad` hooks.
 */
export function PhotoCarousel({
  items,
  currentIndex,
  windowIndices,
  onPrevious,
  onNext,
  isLoaded,
  markLoaded,
  controlsVisible = true,
  onTap,
  className,
  style,
}: PhotoCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number | null>(null);
  const dragDeltaX = useRef(0);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsTouchDevice(window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  }, []);

  const currentItem = items[currentIndex];
  const currentLoaded = currentItem ? isLoaded(currentItem.id) : true;

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

    // Restore the snap transition and animate the track back to rest.
    if (trackRef.current) {
      trackRef.current.style.transition = '';
      trackRef.current.style.transform = 'translateX(0px)';
    }

    if (Math.abs(delta) >= SWIPE_COMMIT_PX && items.length > 1) {
      if (delta < 0) onNext();
      else onPrevious();
      return;
    }

    // Tap (no significant movement) — toggle controls on touch devices, unless
    // the tap landed on an interactive control.
    if (Math.abs(delta) >= TAP_PX) return;
    if (!isTouchDevice) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, [role="button"]')) return;
    onTap?.();
  };

  return (
    <div
      className={cn('relative flex items-center justify-center overflow-hidden', className)}
      style={style}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {items.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrevious();
          }}
          className={`absolute left-4 z-20 hidden h-14 w-14 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-opacity duration-200 hover:bg-white/15 md:left-8 md:flex cursor-pointer ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          aria-label="Previous photo"
        >
          <ArrowLeft className="h-7 w-7" strokeWidth={1.5} />
        </button>
      )}

      {/* Image stack — the current photo plus its window, all mounted and
          eagerly fetched. Each slide sits at its slot; the track wrapping them
          is dragged live by the finger and eases back on release. */}
      <div className="relative w-full h-full" style={{ minHeight: 0 }}>
        <div
          ref={trackRef}
          className="absolute inset-0 transition-transform duration-300 ease-out will-change-transform"
        >
          {windowIndices.map((i) => {
            const item = items[i];
            if (!item) return null;
            const offset = slideOffset(i, currentIndex, items.length);
            const src = item.thumbMedium ?? item.url;
            return (
              <Image
                key={item.id}
                src={src}
                alt={item.alt || 'Photo'}
                fill
                className="object-contain pointer-events-none transition-transform duration-300 ease-out"
                style={{ transform: `translateX(${offset * 100}%)` }}
                loading="eager"
                sizes="100vw"
                draggable={false}
                onLoad={() => markLoaded(item.id)}
                unoptimized={src.includes('/api/') || src.includes('localhost')}
              />
            );
          })}
        </div>
        {currentLoaded ? null : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/70" aria-hidden />
          </div>
        )}
      </div>

      {items.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
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
  );
}
