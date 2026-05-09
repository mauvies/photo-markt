import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import sharp from 'sharp';
import { validatePhotoUpload } from '../../lib/photo-upload';

function fileFrom(buffer: Buffer, name: string, type: string): File {
  // Wrap in a fresh Uint8Array so the BlobPart type resolves cleanly under
  // strict TS (Node Buffer's ArrayBufferLike is not assignable to ArrayBuffer).
  return new File([new Uint8Array(buffer)], name, { type });
}

test('rejects an SVG with image/jpeg MIME (magic-byte check beats client MIME)', async () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    'utf8',
  );
  const file = fileFrom(svg, 'attack.jpg', 'image/jpeg');
  await assert.rejects(() => validatePhotoUpload(file), /not a valid image|Unsupported/);
});

test('rejects an HTML file disguised as an image', async () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
  const file = fileFrom(html, 'evil.png', 'image/png');
  await assert.rejects(() => validatePhotoUpload(file), /not a valid image|Unsupported/);
});

test('accepts a real JPEG buffer regardless of file.name', async () => {
  const jpeg = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#abcdef' },
  })
    .jpeg()
    .toBuffer();
  const file = fileFrom(jpeg, 'photo.weird-extension', 'image/jpeg');
  const validated = await validatePhotoUpload(file);
  assert.equal(validated.contentType, 'image/jpeg');
  assert.equal(validated.extension, 'jpg');
  assert.ok(validated.buffer.length > 0);
});

test('accepts a real PNG and derives extension from detected format', async () => {
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#abcdef' },
  })
    .png()
    .toBuffer();
  const file = fileFrom(png, 'whatever.fake', 'application/octet-stream');
  const validated = await validatePhotoUpload(file);
  assert.equal(validated.contentType, 'image/png');
  assert.equal(validated.extension, 'png');
});

test('rejects a file larger than 50 MB', async () => {
  // 51 MB of zeros — Sharp won't even be called; size check trips first.
  const big = Buffer.alloc(51 * 1024 * 1024);
  const file = fileFrom(big, 'big.jpg', 'image/jpeg');
  await assert.rejects(() => validatePhotoUpload(file), /too large/i);
});
