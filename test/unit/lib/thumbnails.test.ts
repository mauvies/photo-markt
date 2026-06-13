import { describe, expect, it } from 'vitest';
import { generateThumbnail, thumbRelativeUrl, thumbStoragePath } from '@/lib/thumbnails';

describe('thumbStoragePath', () => {
  it('derives thumbs path from a jpg original', () => {
    const result = thumbStoragePath('uid/eventId/abc123.jpg', 'small');
    expect(result).toBe('uid/eventId/thumbs/abc123/small.webp');
  });

  it('handles png extension', () => {
    const result = thumbStoragePath('uid/eventId/abc123.png', 'medium');
    expect(result).toBe('uid/eventId/thumbs/abc123/medium.webp');
  });

  it('handles webp extension', () => {
    const result = thumbStoragePath('uid/eventId/abc123.webp', 'small');
    expect(result).toBe('uid/eventId/thumbs/abc123/small.webp');
  });

  it('handles heic extension', () => {
    const result = thumbStoragePath('uid/eventId/abc123.heic', 'medium');
    expect(result).toBe('uid/eventId/thumbs/abc123/medium.webp');
  });

  it('handles path without extension', () => {
    const result = thumbStoragePath('uid/eventId/abc123', 'small');
    expect(result).toBe('uid/eventId/thumbs/abc123/small.webp');
  });

  it('preserves directory depth correctly', () => {
    const result = thumbStoragePath('user-uuid/event-uuid/photo-uuid.JPG', 'medium');
    expect(result).toBe('user-uuid/event-uuid/thumbs/photo-uuid/medium.webp');
  });
});

describe('thumbRelativeUrl', () => {
  it('builds a root-relative URL for small', () => {
    const result = thumbRelativeUrl('uid/eventId/abc123.jpg', 'small');
    expect(result).toBe('/api/thumb/uid/eventId/thumbs/abc123/small.webp');
  });

  it('builds a root-relative URL for medium', () => {
    const result = thumbRelativeUrl('uid/eventId/abc123.jpg', 'medium');
    expect(result).toBe('/api/thumb/uid/eventId/thumbs/abc123/medium.webp');
  });
});

describe('generateThumbnail', () => {
  it('produces a WebP buffer smaller than the source at small size', async () => {
    // Create a 1200x800 test image using sharp directly
    const sharp = (await import('sharp')).default;
    const sourceBuffer = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 150, b: 100 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    const thumb = await generateThumbnail(sourceBuffer, 'small');

    // Must be a Buffer
    expect(Buffer.isBuffer(thumb)).toBe(true);
    expect(thumb.byteLength).toBeGreaterThan(0);

    // Verify it's valid WebP and dimensions are correct
    const metadata = await sharp(thumb).metadata();
    expect(metadata.format).toBe('webp');
    // Longest side ≤ 400
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(400);
    // Aspect ratio preserved (width/height ratio within 1%)
    const originalAspect = 1200 / 800;
    const thumbAspect = (metadata.width ?? 1) / (metadata.height ?? 1);
    expect(Math.abs(thumbAspect - originalAspect)).toBeLessThan(0.01);
  });

  it('produces correct dimensions for medium size', async () => {
    const sharp = (await import('sharp')).default;
    const sourceBuffer = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .png()
      .toBuffer();

    const thumb = await generateThumbnail(sourceBuffer, 'medium');
    const metadata = await sharp(thumb).metadata();

    expect(metadata.format).toBe('webp');
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(800);
  });

  it('does not upscale images smaller than the target', async () => {
    const sharp = (await import('sharp')).default;
    // 100x100 is smaller than the 400px small target
    const sourceBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 50, g: 50, b: 50 } },
    })
      .jpeg()
      .toBuffer();

    const thumb = await generateThumbnail(sourceBuffer, 'small');
    const metadata = await sharp(thumb).metadata();

    // Should not be upscaled
    expect(metadata.width).toBeLessThanOrEqual(100);
    expect(metadata.height).toBeLessThanOrEqual(100);
  });
});
