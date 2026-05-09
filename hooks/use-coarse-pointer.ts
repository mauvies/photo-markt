'use client';

import { useEffect, useState } from 'react';

/**
 * True when the primary input is touch-only (mobile/tablet with no mouse).
 * Lets components opt out of hover-only affordances like tooltips, which
 * Radix opens on touch — causing the "tooltip flashes before the action
 * fires" UX on iOS.
 *
 * Returns `false` during SSR and on the first render to avoid hydration
 * mismatches; flips after mount based on the actual environment.
 */
export function useCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(hover: none) and (pointer: coarse)');
    setIsCoarse(query.matches);
    const handler = (e: MediaQueryListEvent) => setIsCoarse(e.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  return isCoarse;
}
