import { describe, expect, it } from 'vitest';
import { getLightboxWindow } from '@/components/photo-lightbox-window';

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
