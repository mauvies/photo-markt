import { describe, expect, it } from 'vitest';
import { resolveGalleryTileSrc } from '@/lib/gallery-tile-src';

describe('resolveGalleryTileSrc', () => {
  it('prefers the 400px small thumbnail over the 800px medium (T-125)', () => {
    expect(
      resolveGalleryTileSrc({
        thumbSmall: '/api/thumb/a/small.webp',
        thumbMedium: '/api/thumb/a/medium.webp',
        url: 'https://signed/original.jpg',
      }),
    ).toBe('/api/thumb/a/small.webp');
  });

  it('falls back to medium when no small variant is present', () => {
    expect(
      resolveGalleryTileSrc({
        thumbMedium: '/api/thumb/a/medium.webp',
        url: 'https://signed/original.jpg',
      }),
    ).toBe('/api/thumb/a/medium.webp');
  });

  it('falls back to the full url when no thumbnails have baked', () => {
    expect(resolveGalleryTileSrc({ url: 'https://signed/original.jpg' })).toBe(
      'https://signed/original.jpg',
    );
  });
});
