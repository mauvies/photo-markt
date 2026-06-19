import { describe, expect, it } from 'vitest';
import { getLightboxWindow, slideOffset } from '@/components/photo-lightbox-window';

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

describe('getLightboxWindow', () => {
  it('returns the current photo plus radius neighbours', () => {
    expect(sorted(getLightboxWindow(5, 10, 2))).toEqual([3, 4, 5, 6, 7]);
  });

  it('wraps around at the start', () => {
    expect(sorted(getLightboxWindow(0, 10, 2))).toEqual([0, 1, 2, 8, 9]);
  });

  it('wraps around at the end', () => {
    expect(sorted(getLightboxWindow(9, 10, 2))).toEqual([0, 1, 7, 8, 9]);
  });

  it('deduplicates when the gallery is smaller than the window', () => {
    const window = getLightboxWindow(0, 3, 2);
    expect(window).toHaveLength(3);
    expect(sorted(window)).toEqual([0, 1, 2]);
  });

  it('returns a single index for a one-photo gallery', () => {
    expect(getLightboxWindow(0, 1, 2)).toEqual([0]);
  });

  it('returns an empty array for an empty gallery or out-of-range index', () => {
    expect(getLightboxWindow(0, 0, 2)).toEqual([]);
    expect(getLightboxWindow(5, 3, 2)).toEqual([]);
    expect(getLightboxWindow(-1, 3, 2)).toEqual([]);
  });

  it('always includes the current index', () => {
    for (let i = 0; i < 8; i += 1) {
      expect(getLightboxWindow(i, 8, 2)).toContain(i);
    }
  });
});

describe('slideOffset', () => {
  it('is 0 for the current slide', () => {
    expect(slideOffset(5, 5, 10)).toBe(0);
  });

  it('gives positive slots to the right, negative to the left', () => {
    expect(slideOffset(6, 5, 10)).toBe(1);
    expect(slideOffset(4, 5, 10)).toBe(-1);
    expect(slideOffset(7, 5, 10)).toBe(2);
    expect(slideOffset(3, 5, 10)).toBe(-2);
  });

  it('places the wrap-around previous neighbour one slot to the left', () => {
    // Showing the first photo: the last photo is the circular "previous", so
    // it must sit at -1, not +(total-1).
    expect(slideOffset(9, 0, 10)).toBe(-1);
    expect(slideOffset(8, 0, 10)).toBe(-2);
  });

  it('places the wrap-around next neighbour one slot to the right', () => {
    expect(slideOffset(0, 9, 10)).toBe(1);
    expect(slideOffset(1, 9, 10)).toBe(2);
  });

  it('keeps neighbours adjacent in a gallery smaller than the window', () => {
    // 3-photo loop: from photo 0, photo 2 is the previous (-1), photo 1 next (+1).
    expect(slideOffset(1, 0, 3)).toBe(1);
    expect(slideOffset(2, 0, 3)).toBe(-1);
  });

  it('returns 0 for an empty gallery', () => {
    expect(slideOffset(0, 0, 0)).toBe(0);
  });
});
