'use client';

import { useCallback, useState } from 'react';

/**
 * Photo-grid selection state, shared by the event viewers and the AI
 * face-search results view. `isSelecting` flips on automatically when the
 * first photo is picked and off when the last one is cleared.
 */
export function usePhotoSelection() {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggle = useCallback((photoId: string) => {
    setSelectedIds((current) => {
      const exists = current.includes(photoId);
      const next = exists ? current.filter((id) => id !== photoId) : [...current, photoId];
      setIsSelecting(next.length > 0);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedIds([]);
    setIsSelecting(false);
  }, []);

  const startSelecting = useCallback(() => setIsSelecting(true), []);

  return { isSelecting, selectedIds, toggle, clear, startSelecting };
}
