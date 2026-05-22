/** @vitest-environment happy-dom */
import { renderHook } from '@testing-library/react';
import type { TouchEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLongPress } from '@/hooks/use-long-press';

/** A minimal stand-in for a React touch event — the hook only reads `touches[0]`. */
function touch(x: number, y: number): TouchEvent {
  return { touches: [{ clientX: x, clientY: y }] } as unknown as TouchEvent;
}

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onLongPress once the press duration elapses', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, durationMs: 450 }));

    result.current.onTouchStart(touch(0, 0));
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(450);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire before the duration elapses', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, durationMs: 450 }));

    result.current.onTouchStart(touch(0, 0));
    vi.advanceTimersByTime(449);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels when the finger moves past the tolerance (a scroll)', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useLongPress({ onLongPress, durationMs: 450, moveTolerancePx: 10 }),
    );

    result.current.onTouchStart(touch(0, 0));
    result.current.onTouchMove(touch(0, 30));
    vi.advanceTimersByTime(450);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('keeps the timer for a small jitter within the tolerance', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useLongPress({ onLongPress, durationMs: 450, moveTolerancePx: 10 }),
    );

    result.current.onTouchStart(touch(0, 0));
    result.current.onTouchMove(touch(3, 4)); // hypot = 5px, within tolerance
    vi.advanceTimersByTime(450);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when disabled (non-touch devices)', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, enabled: false }));

    result.current.onTouchStart(touch(0, 0));
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('onTouchEnd clears a pending timer (a plain tap)', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, durationMs: 450 }));

    result.current.onTouchStart(touch(0, 0));
    result.current.onTouchEnd();
    vi.advanceTimersByTime(450);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('consumedClick reports a long-press exactly once, then resets', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, durationMs: 450 }));

    result.current.onTouchStart(touch(0, 0));
    vi.advanceTimersByTime(450);

    expect(result.current.consumedClick()).toBe(true);
    expect(result.current.consumedClick()).toBe(false);
  });

  it('consumedClick stays false for a tap that never became a long-press', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, durationMs: 450 }));

    result.current.onTouchStart(touch(0, 0));
    result.current.onTouchEnd();
    expect(result.current.consumedClick()).toBe(false);
  });
});
