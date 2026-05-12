import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { validatePhotoUpload } from '../../lib/photo-upload';

function fileFrom(buffer: Buffer, name: string, type: string): File {
  // Wrap in a fresh Uint8Array so the BlobPart type resolves cleanly under
  // strict TS (Node Buffer's ArrayBufferLike is not assignable to ArrayBuffer).
  return new File([new Uint8Array(buffer)], name, { type });
}

describe('validatePhotoUpload', () => {
  it('rejects an SVG with image/jpeg MIME (magic-byte check beats client MIME)', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      'utf8',
    );
    const file = fileFrom(svg, 'attack.jpg', 'image/jpeg');
    await expect(validatePhotoUpload(file)).rejects.toThrow(/not a valid image|Unsupported/);
  });

  it('rejects an HTML file disguised as an image', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
    const file = fileFrom(html, 'evil.png', 'image/png');
    await expect(validatePhotoUpload(file)).rejects.toThrow(/not a valid image|Unsupported/);
  });

  it('accepts a real JPEG buffer regardless of file.name', async () => {
    const jpeg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#abcdef' },
    })
      .jpeg()
      .toBuffer();
    const file = fileFrom(jpeg, 'photo.weird-extension', 'image/jpeg');
    const validated = await validatePhotoUpload(file);
    expect(validated.contentType).toBe('image/jpeg');
    expect(validated.extension).toBe('jpg');
    expect(validated.buffer.length).toBeGreaterThan(0);
  });

  it('accepts a real PNG and derives extension from detected format', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#abcdef' },
    })
      .png()
      .toBuffer();
    const file = fileFrom(png, 'whatever.fake', 'application/octet-stream');
    const validated = await validatePhotoUpload(file);
    expect(validated.contentType).toBe('image/png');
    expect(validated.extension).toBe('png');
  });

  it('rejects a file larger than 50 MB', async () => {
    // 51 MB of zeros — Sharp won't even be called; size check trips first.
    const big = Buffer.alloc(51 * 1024 * 1024);
    const file = fileFrom(big, 'big.jpg', 'image/jpeg');
    await expect(validatePhotoUpload(file)).rejects.toThrow(/too large/i);
  });
});
