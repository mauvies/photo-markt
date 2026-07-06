/** @vitest-environment happy-dom */
/**
 * Unit tests for the carousel hooks extracted from `photo-lightbox.tsx` (T-066)
 * and shared with `PhotoDetailModal`: wrap-around navigation, keyboard gating,
 * and image-load tracking. These guard the extraction — they fail before the
 * hooks exist and pass after.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCarouselNavigation } from '@/hooks/use-carousel-navigation';
import { useImageLoad } from '@/hooks/use-image-load';
import { useKeyboardNav } from '@/hooks/use-keyboard-nav';

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('useCarouselNavigation', () => {
  it('advances and emits the new id', () => {
    const onIndexChange = vi.fn();
    const { result } = renderHook(() =>
      useCarouselNavigation({ items, open: true, onIndexChange }),
    );

    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(1);
    expect(result.current.currentItem).toEqual({ id: 'b' });
    expect(onIndexChange).toHaveBeenLastCalledWith('b');
  });

  it('wraps from the first item to the last on previous', () => {
    const onIndexChange = vi.fn();
    const { result } = renderHook(() =>
      useCarouselNavigation({ items, open: true, onIndexChange }),
    );

    act(() => result.current.previous());
    expect(result.current.currentIndex).toBe(2);
    expect(onIndexChange).toHaveBeenLastCalledWith('c');
  });

  it('wraps from the last item to the first on next', () => {
    const { result } = renderHook(() =>
      useCarouselNavigation({ items, open: true, initialIndex: 2 }),
    );

    act(() => result.current.next());
    expect(result.current.currentIndex).toBe(0);
  });

  it('resets to initialIndex when reopened', () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useCarouselNavigation({ items, open, initialIndex: 1 }),
      { initialProps: { open: false } },
    );

    rerender({ open: true });
    expect(result.current.currentIndex).toBe(1);
  });
});

describe('useKeyboardNav', () => {
  it('routes arrow keys and Escape while enabled', () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onClose = vi.fn();
    renderHook(() => useKeyboardNav({ enabled: true, onPrevious, onNext, onClose }));

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNav({ enabled: false, onPrevious: vi.fn(), onNext }));

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('useImageLoad', () => {
  it('tracks loaded ids independently', () => {
    const { result } = renderHook(() => useImageLoad());

    expect(result.current.isLoaded('a')).toBe(false);
    act(() => result.current.markLoaded('a'));
    expect(result.current.isLoaded('a')).toBe(true);
    expect(result.current.isLoaded('b')).toBe(false);
  });
});
