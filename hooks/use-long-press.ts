'use client';

import { useCallback, useEffect, useRef } from 'react';

interface UseLongPressOptions {
  /** Fired when a press is held past `durationMs` without moving. */
  onLongPress: () => void;
  /** Press duration before the long-press fires. */
  durationMs?: number;
  /** Movement (px) past which the press is treated as a scroll and cancelled. */
  moveTolerancePx?: number;
  /** When false every handler is a no-op — pass `useCoarsePointer()` so the
   * long-press only arms on touch devices and never competes with desktop. */
  enabled?: boolean;
}

export interface LongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  /** Returns true exactly once if a long-press just fired — lets the caller
   * suppress the trailing synthetic `click` (tap → lightbox). */
  consumedClick: () => boolean;
}

/**
 * Long-press detection for touch devices. A press held for `durationMs`
 * without moving past `moveTolerancePx` fires `onLongPress`. It distinguishes
 * a long-press from a scroll — any move past the tolerance clears the timer,
 * and `onTouchStart` never calls `preventDefault`, so native scrolling is
 * left fully intact.
 */
export function useLongPress({
  onLongPress,
  durationMs = 450,
  moveTolerancePx = 10,
  enabled = true,
}: UseLongPressOptions): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Drop any pending timer if the tile unmounts mid-press.
  useEffect(() => clearTimer, [clearTimer]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0];
      if (!touch) return;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      firedRef.current = false;
      clearTimer();
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        timerRef.current = null;
        onLongPress();
      }, durationMs);
    },
    [enabled, durationMs, onLongPress, clearTimer],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || timerRef.current === null || !startRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;
      if (Math.hypot(dx, dy) > moveTolerancePx) clearTimer();
    },
    [enabled, moveTolerancePx, clearTimer],
  );

  const onTouchEnd = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const consumedClick = useCallback(() => {
    if (firedRef.current) {
      firedRef.current = false;
      return true;
    }
    return false;
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd, consumedClick };
}
