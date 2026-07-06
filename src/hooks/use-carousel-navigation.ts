'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getLightboxWindow } from '@/components/photo-lightbox-window';

/** Default preload radius — the current item plus this many neighbours on each
 * side are kept in the render window so navigation reveals a decoded image. */
const DEFAULT_PRELOAD_RADIUS = 2;

export interface CarouselNavigation<T> {
  currentIndex: number;
  currentItem: T | undefined;
  /** Indices of the current item plus its ±radius neighbours (see getLightboxWindow). */
  windowIndices: number[];
  next: () => void;
  previous: () => void;
  setIndex: (index: number) => void;
}

/**
 * Carousel index state with wrap-around prev/next, shared by the lightbox and
 * the two-panel photo modal. Extracted from `photo-lightbox.tsx` so both
 * components navigate identically.
 *
 * `onIndexChange` fires with the NEW item id only on user-initiated
 * navigation (next/previous) — never as a side effect of a parent re-render —
 * so consumers can mirror the current photo into a URL without the carousel
 * auto-advancing when the items array is rebuilt.
 */
export function useCarouselNavigation<T extends { id: string }>(params: {
  items: T[];
  open: boolean;
  initialIndex?: number;
  onIndexChange?: (id: string) => void;
  preloadRadius?: number;
}): CarouselNavigation<T> {
  const {
    items,
    open,
    initialIndex = 0,
    onIndexChange,
    preloadRadius = DEFAULT_PRELOAD_RADIUS,
  } = params;

  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  // Snap back to the requested index whenever the carousel (re)opens.
  useEffect(() => {
    if (open) setCurrentIndex(initialIndex);
  }, [open, initialIndex]);

  const currentItem = items[currentIndex];

  const windowIndices = useMemo(
    () => getLightboxWindow(currentIndex, items.length, preloadRadius),
    [currentIndex, items.length, preloadRadius],
  );

  const previous = useCallback(() => {
    const nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    setCurrentIndex(nextIndex);
    const id = items[nextIndex]?.id;
    if (id) onIndexChange?.(id);
  }, [currentIndex, items, onIndexChange]);

  const next = useCallback(() => {
    const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    setCurrentIndex(nextIndex);
    const id = items[nextIndex]?.id;
    if (id) onIndexChange?.(id);
  }, [currentIndex, items, onIndexChange]);

  return { currentIndex, currentItem, windowIndices, next, previous, setIndex: setCurrentIndex };
}
