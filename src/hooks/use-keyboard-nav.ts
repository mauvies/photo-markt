'use client';

import { useEffect } from 'react';

/**
 * Wire ArrowLeft/ArrowRight/Escape to carousel navigation while `enabled`.
 * Extracted from `photo-lightbox.tsx` so the lightbox and the photo modal
 * share identical keyboard semantics.
 *
 * `onClose` is optional: the Shadcn Dialog used by the modal already closes on
 * Escape, so the modal wires only the arrow keys and omits `onClose`.
 */
export function useKeyboardNav(params: {
  enabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose?: () => void;
}): void {
  const { enabled, onPrevious, onNext, onClose } = params;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.();
      } else if (e.key === 'ArrowLeft') {
        onPrevious();
      } else if (e.key === 'ArrowRight') {
        onNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onPrevious, onNext, onClose]);
}
