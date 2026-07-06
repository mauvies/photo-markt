'use client';

import { useCallback, useState } from 'react';

export interface ImageLoadTracker {
  isLoaded: (id: string) => boolean;
  markLoaded: (id: string) => void;
}

/**
 * Track which carousel images have finished decoding, so a loading spinner can
 * be shown until the current image lands. Extracted from `photo-lightbox.tsx`
 * so the lightbox and the photo modal share one loading model.
 */
export function useImageLoad(): ImageLoadTracker {
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());

  const markLoaded = useCallback((id: string) => {
    setLoadedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const isLoaded = useCallback((id: string) => loadedIds.has(id), [loadedIds]);

  return { isLoaded, markLoaded };
}
