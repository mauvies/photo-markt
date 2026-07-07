import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { addWatermarkToImage, type FaceBox, selectFaceBadgeRect } from '@/lib/watermark';

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
    // longest side capped at 1024
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1024);
  });

  it('composites a face badge without throwing, and tile-only when no faces', async () => {
    const source = await sharp({
      create: { width: 1024, height: 768, channels: 3, background: '#777' },
    })
      .jpeg()
      .toBuffer();

    const faces: FaceBox[] = [
      { boundingBox: { Left: 0.4, Top: 0.3, Width: 0.2, Height: 0.25 }, confidence: 99 },
    ];

    const withFace = await addWatermarkToImage(source, faces);
    const tileOnly = await addWatermarkToImage(source, []);

    expect((await sharp(withFace).metadata()).format).toBe('jpeg');
    expect((await sharp(tileOnly).metadata()).format).toBe('jpeg');
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

  // The tiled mosaic must adapt to any aspect ratio: portrait, landscape and
  // square all come back as a JPEG whose longest side is capped at 1024 with the
  // aspect ratio preserved (proportional scaling, no stretch).
  it.each([
    ['portrait', 1200, 1600, 768, 1024],
    ['landscape', 1600, 1200, 1024, 768],
    ['square', 1400, 1400, 1024, 1024],
  ])('watermarks a %s photo with proportional scaling', async (_label, w, h, expW, expH) => {
    const source = await sharp({
      create: { width: w, height: h, channels: 3, background: '#666' },
    })
      .jpeg()
      .toBuffer();

    const meta = await sharp(await addWatermarkToImage(source)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(expW);
    expect(meta.height).toBe(expH);
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1024);
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

describe('selectFaceBadgeRect', () => {
  const W = 1000;
  const H = 800;

  it('returns null when there are no faces', () => {
    expect(selectFaceBadgeRect([], W, H)).toBeNull();
    expect(selectFaceBadgeRect(undefined, W, H)).toBeNull();
  });

  it('scales the normalized box to pixels and centers the badge', () => {
    const rect = selectFaceBadgeRect(
      [{ boundingBox: { Left: 0.4, Top: 0.25, Width: 0.2, Height: 0.25 }, confidence: 99 }],
      W,
      H,
    );
    // box = 200x200 px at (400,200); badge = 70% = 140x140, centered → +30,+30
    expect(rect).toEqual({ left: 430, top: 230, width: 140, height: 140 });
  });

  it('picks the largest face (tie-break on confidence)', () => {
    const rect = selectFaceBadgeRect(
      [
        { boundingBox: { Left: 0, Top: 0, Width: 0.1, Height: 0.1 }, confidence: 99 },
        { boundingBox: { Left: 0.5, Top: 0.5, Width: 0.4, Height: 0.4 }, confidence: 80 },
      ],
      W,
      H,
    );
    // larger box wins despite lower confidence: 0.4*1000 * 0.7 = 280 wide
    expect(rect?.width).toBe(280);
  });

  it('returns null for a degenerate (sub-pixel) box', () => {
    expect(
      selectFaceBadgeRect(
        [{ boundingBox: { Left: 0, Top: 0, Width: 0.0001, Height: 0.0001 }, confidence: 99 }],
        W,
        H,
      ),
    ).toBeNull();
  });
});
