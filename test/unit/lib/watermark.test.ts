import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { addWatermarkToImage, computeFaceBlurRects, type FaceBox } from '@/lib/watermark';
import { checkerboardJpeg, regionStdev } from '../../helpers/image';

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

  it('tile-only (no error) when no faces are supplied', async () => {
    const source = await sharp({
      create: { width: 1024, height: 768, channels: 3, background: '#777' },
    })
      .jpeg()
      .toBuffer();

    const tileOnly = await addWatermarkToImage(source, []);
    expect((await sharp(tileOnly).metadata()).format).toBe('jpeg');
  });

  // T-068: every detected face is blurred to non-identifiable. Fails on the old
  // (badge-only) pipeline where the face region kept its full detail.
  it('blurs the face region so its detail collapses', async () => {
    const source = await checkerboardJpeg(1024, 768);
    const faces: FaceBox[] = [
      { boundingBox: { Left: 0.4, Top: 0.35, Width: 0.2, Height: 0.25 }, confidence: 99 },
    ];

    const withFace = await addWatermarkToImage(source, faces);
    const noFace = await addWatermarkToImage(source, []);

    // Sample well inside the (margin-expanded) blurred zone.
    const core = { left: 450, top: 320, width: 120, height: 100 };
    const blurred = await regionStdev(withFace, core);
    const detailed = await regionStdev(noFace, core);

    // The checkerboard core is high-contrast (stdev ~120); a strong blur crushes
    // it far below the un-blurred version.
    expect(blurred).toBeLessThan(detailed * 0.5);
  });

  it('blurs every face when several are present', async () => {
    const source = await checkerboardJpeg(1024, 768);
    const faces: FaceBox[] = [
      { boundingBox: { Left: 0.1, Top: 0.1, Width: 0.15, Height: 0.2 }, confidence: 99 },
      { boundingBox: { Left: 0.7, Top: 0.6, Width: 0.15, Height: 0.2 }, confidence: 98 },
    ];
    const withFaces = await addWatermarkToImage(source, faces);
    const noFace = await addWatermarkToImage(source, []);

    for (const region of [
      { left: 130, top: 100, width: 80, height: 90 },
      { left: 730, top: 480, width: 80, height: 90 },
    ]) {
      const blurred = await regionStdev(withFaces, region);
      const detailed = await regionStdev(noFace, region);
      expect(blurred).toBeLessThan(detailed * 0.5);
    }
  });

  // Critical constraint: the ORIGINAL buffer is never mutated by preview gen.
  it('does not mutate the input buffer', async () => {
    const source = await checkerboardJpeg(512, 512);
    const copy = Buffer.from(source);
    await addWatermarkToImage(source, [
      { boundingBox: { Left: 0.3, Top: 0.3, Width: 0.3, Height: 0.3 }, confidence: 99 },
    ]);
    expect(Buffer.compare(source, copy)).toBe(0);
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

describe('computeFaceBlurRects', () => {
  const W = 1000;
  const H = 800;

  it('returns [] when there are no faces', () => {
    expect(computeFaceBlurRects([], W, H)).toEqual([]);
    expect(computeFaceBlurRects(undefined, W, H)).toEqual([]);
  });

  it('maps a normalized box to pixels and adds a margin', () => {
    const rects = computeFaceBlurRects(
      [{ boundingBox: { Left: 0.4, Top: 0.25, Width: 0.2, Height: 0.25 }, confidence: 99 }],
      W,
      H,
    );
    // box = 200x200 px at (400,200); margin = 15% = 30px each side →
    // left/top back off 30, width/height grow by 60.
    expect(rects).toEqual([{ left: 370, top: 170, width: 260, height: 260 }]);
  });

  it('returns a rect for every face (all faces are blurred)', () => {
    const rects = computeFaceBlurRects(
      [
        { boundingBox: { Left: 0, Top: 0, Width: 0.1, Height: 0.1 }, confidence: 99 },
        { boundingBox: { Left: 0.5, Top: 0.5, Width: 0.4, Height: 0.4 }, confidence: 80 },
      ],
      W,
      H,
    );
    expect(rects).toHaveLength(2);
  });

  it('clamps a box at the edge to stay on the image', () => {
    const [rect] = computeFaceBlurRects(
      [{ boundingBox: { Left: 0.95, Top: 0.95, Width: 0.1, Height: 0.1 }, confidence: 99 }],
      W,
      H,
    );
    expect(rect.left + rect.width).toBeLessThanOrEqual(W);
    expect(rect.top + rect.height).toBeLessThanOrEqual(H);
  });

  it('drops a degenerate (sub-pixel) box', () => {
    expect(
      computeFaceBlurRects(
        [{ boundingBox: { Left: 0, Top: 0, Width: 0.0001, Height: 0.0001 }, confidence: 99 }],
        W,
        H,
      ),
    ).toEqual([]);
  });

  it('skips a face box with no bounding data', () => {
    expect(
      computeFaceBlurRects(
        [{ boundingBox: undefined as unknown as Record<string, number>, confidence: 99 }],
        W,
        H,
      ),
    ).toEqual([]);
  });
});
