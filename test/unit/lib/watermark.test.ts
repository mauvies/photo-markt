import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { addWatermarkToImage } from '@/lib/watermark';

describe('addWatermarkToImage', () => {
  it('watermarks a large image and returns a JPEG', async () => {
    const source = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: '#777' },
    })
      .jpeg()
      .toBuffer();

    const out = await addWatermarkToImage(source);
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe('jpeg');
    // longest side capped at 1200
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1200);
  });

  // Regression: a source image smaller than the 400px watermark tile produced
  // a base canvas smaller than the tile, and Sharp's tiled composite threw
  // "Image to composite must have same dimensions or smaller" → 502 from the
  // watermark route. The tile must be shrunk to fit small previews.
  it('watermarks an image smaller than the watermark tile without throwing', async () => {
    const tiny = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#888' },
    })
      .png()
      .toBuffer();

    const out = await addWatermarkToImage(tiny);
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe('jpeg');
    // not enlarged — preview keeps the small source dimensions
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
  });

  it('watermarks an image with one dimension below the tile size', async () => {
    const sliver = await sharp({
      create: { width: 1000, height: 150, channels: 3, background: '#999' },
    })
      .jpeg()
      .toBuffer();

    const out = await addWatermarkToImage(sliver);
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1000);
    expect(meta.height).toBe(150);
  });
});
